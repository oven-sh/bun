use std::cell::OnceCell;
use std::collections::BTreeMap;
use std::mem::take;
use std::sync::OnceLock;

use bun_ast::Loader;
use bun_core::{CodeGenerationFromStrings, strings};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::join_spill;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, CodeUnit};
use bun_sema::hir::{ExprId, ExprKind, Flags, StmtKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier, ResolvedForm};
use bun_sema::program::{CodeAnswer, CodeView, EntryPointsFound, FileId, Files, NamingLoad};
use bun_sema::resolve::{CodeHost, CodeOptions, Host, is_declaration_file_name, to_path};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use bun_sema_driver::host::{from_native, to_native};
use bun_sema_driver::{FileFinder, FileFinderTables, resolve_names_known_in_part};
use bun_threading::Guarded;

use super::load_names::find_files_followed_further_than_bundler;
use super::worker_entries::{
    PlaceOfName, WorkerNameForm, WorkerStart, read_file_url, source_path_of,
};
use crate::builtins::ResolvedBuiltins;
use crate::builtins::table::{self, BuiltinFlags, BuiltinId, Origin};
use crate::compile::EntryPointPaths;
use crate::load::externals::contains;
use crate::load::host::{LoadHost, ResolveWhoseFoldersBringNothing};
use crate::load::loaders::{gives_data, loader_named_by_path, script_kind_of};
use crate::load::module_paths::{
    FOLDER_ABOVE_ROOT, compute_relative_path, count_folders, spell_folder_above_root,
    spell_with_other_levels,
};
use crate::load::sources::{SourceKind, count_levels_above_root, parsed_source_in};
use crate::load::{is_host_path, is_in_node_modules};
use crate::module_keys::is_name_of_text;
use crate::options::{EntryText, Options, PathOptions};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum FoundBecause {
    StartsWorker,
    MayStartWorker,
    NamedByData,
    PassedForParameter,
    FollowedFurtherThanBundler,
    WrittenInArm,
}

impl FoundBecause {
    pub(crate) fn is_for_worker(self) -> bool {
        matches!(
            self,
            FoundBecause::StartsWorker | FoundBecause::MayStartWorker
        )
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct FoundEntryPoint {
    pub source_path: Vec<u8>,
    pub name: Vec<u8>,
    pub because: FoundBecause,
    pub started_at: Option<(Vec<u8>, u32)>,
    pub starts: Vec<(FileId, u32)>,
    /// Nothing more than a Worker that may start from it names the file.
    pub is_guess: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum LeftOutBecause {
    LiesOutsideRoot,
    KeptOutByPlugin,
}

/// A text that may be the name of a Worker's file, and the file, which isn't compiled.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct NameLeftOut {
    pub because: LeftOutBecause,
    pub leads_to: Vec<u8>,
    pub name: Vec<u8>,
    pub written_in: Vec<u8>,
    pub written_at: u32,
}

pub(crate) struct FinderInput<'a, 'h> {
    pub host: &'a LoadHost<'h>,
    pub code: &'a CodeOptions,
    pub options: &'a Options<'a>,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum ReadAs {
    EntryPoint,
    PathFromOwnFolder,
    Url,
    Import,
    Require,
}

type NameKnownInPart = (Vec<u8>, Option<Vec<u8>>);

#[derive(PartialEq, Eq, Hash)]
struct Question {
    file_name: Vec<u8>,
    read_as: ReadAs,
    names: Vec<NameKnownInPart>,
    is_guess: bool,
    /// Nothing says that a Worker starts from the file.
    is_written_elsewhere: bool,
}

enum Named {
    ByName(Question),
    File {
        path: Vec<u8>,
        path_of_copy: Option<Vec<u8>>,
    },
    Url {
        url: Vec<u8>,
        levels: Option<usize>,
    },
    Text {
        text: EntryText,
        levels: Option<usize>,
    },
}

#[derive(Default)]
struct CodeOfWorkers {
    urls: Vec<Atom>,
    texts: Vec<(Atom, Option<Atom>)>,
}

struct Mention {
    named: Named,
    because: FoundBecause,
    started_at: Option<(Vec<u8>, u32)>,
    named_by: Option<NamingLoad>,
}

struct NamedFile {
    path: Vec<u8>,
    written_down_as: Option<Vec<u8>>,
}

impl NamedFile {
    fn at(path: Vec<u8>) -> NamedFile {
        NamedFile {
            path,
            written_down_as: None,
        }
    }
}

#[derive(Default)]
struct FoundSoFar {
    asked: FxHashMap<Question, Vec<Vec<u8>>>,
    named_otherwise: FxHashSet<Vec<u8>>,
    urls_read: FxHashSet<(Vec<u8>, Option<usize>)>,
    texts_in_program: FxHashSet<Vec<u8>>,
    code_of_levels: Vec<(usize, Vec<u8>, Vec<u8>)>,
    reach_in_front_of_drop: Vec<Vec<u8>>,
    entry_points: Vec<(Vec<u8>, FoundEntryPoint)>,
    merely_guessed: FxHashSet<Vec<u8>>,
    named_for_more_than_a_worker_that_may_start: FxHashSet<Vec<u8>>,
    named_by_more_than_workers: FxHashSet<Vec<u8>>,
    named_as_what_a_worker_may_start: FxHashSet<Vec<u8>>,
    names_written: Vec<EntryPointPaths>,
    names_left_out: Vec<NameLeftOut>,
}

fn names_only_what_reaches_no_file(
    code: &dyn CodeView<'_>,
    file: FileId,
    builtins: &ResolvedBuiltins,
) -> bool {
    let reaches_beyond_file = BuiltinFlags::EVALUATES_TEXT
        | BuiltinFlags::RUNS_UNSEEN_CODE
        | BuiltinFlags::LOADS_MODULE_BY_NAME
        | BuiltinFlags::IS_GLOBAL_OBJECT;
    let is_held_by = |id: BuiltinId, holder: BuiltinId| {
        let mut holders = std::iter::successors(Some(id), |&id| table::entry(id).holder);
        holders.any(|id| id == holder)
    };
    let may_be_named = |&id: &BuiltinId| {
        let id = table::canonical_id(id);
        match table::entry(id).origin {
            Origin::Engine => {
                !table::entry(id).flags.intersects(reaches_beyond_file)
                    && !is_held_by(id, BuiltinId::Promise)
            }
            Origin::Host => {
                let of_module = [
                    BuiltinId::ModuleRequire,
                    BuiltinId::ModuleObject,
                    BuiltinId::ModuleObjectExports,
                ];
                of_module.contains(&id) || is_held_by(id, BuiltinId::Console)
            }
        }
    };
    let hir = code.hir(file);
    let mut sites = code.analysis(file).import_sites.iter();
    let holds_handler = hir.stmts.iter().any(|it| {
        matches!(
            it.kind,
            StmtKind::Try { .. } | StmtKind::ForOf { is_await: true, .. }
        )
    }) || hir.fns.iter().any(|it| it.flags.contains(Flags::ASYNC))
        || hir
            .exprs
            .iter()
            .any(|it| matches!(it.kind, ExprKind::Await(_)))
        || sites.any(|site| matches!(site.kind, ImportSiteKind::ImportCall(_)));
    !holds_handler
        && !builtins.hands_on_loader_of_paths()
        && !builtins.loads_unknown_modules()
        && builtins.loaded_modules().next().is_none()
        && builtins.mentioned().iter().all(may_be_named)
        && (code.bound(file).ident_bindings().iter()).all(|&(name, binding)| match binding {
            Binding::Symbol(_) | Binding::CommonJs(_) => true,
            Binding::Arguments(unit) => unit != CodeUnit::File,
            Binding::Free => builtins.builtin_of_expression(name).is_some(),
        })
}

struct FileFinders<'f> {
    tables: &'f [FileFinderTables; 2],
    host: &'f dyn CodeHost,
    code: [&'f CodeOptions; 2],
    finders: [OnceCell<FileFinder<'f>>; 2],
}

impl<'f> FileFinders<'f> {
    fn finder(&self, index: usize) -> &FileFinder<'f> {
        let (tables, host, code) = (self.tables, self.host, self.code[index]);
        self.finders[index].get_or_init(|| FileFinder::new(&tables[index], host, code))
    }

    fn from_working_directory(&self) -> &FileFinder<'f> {
        self.finder(0)
    }

    fn from_root_directory(&self) -> &FileFinder<'f> {
        match self.code[0].working_directory == self.code[1].working_directory {
            true => self.finder(0),
            false => self.finder(1),
        }
    }
}

pub(crate) fn is_relative_path(text: &[u8]) -> bool {
    text.starts_with(b"./") || text.starts_with(b"../")
}

fn is_bare_name(name: &[u8]) -> bool {
    !is_relative_path(name) && !bun_paths::is_absolute(name)
}

fn names_directory(text: &[u8]) -> bool {
    matches!(text, [.., b'/'] | [.., b'/', b'.'] | [.., b'/', b'.', b'.'])
}

fn normalize(relative: &[u8]) -> Vec<&[u8]> {
    let mut kept: Vec<&[u8]> = Vec::new();
    for segment in strings::split(relative, b"/") {
        match (segment, kept.last()) {
            (b"" | b".", _) => {}
            (b"..", Some(&last)) if last != b".." => {
                kept.pop();
            }

            _ => kept.push(segment),
        }
    }
    kept
}

pub(crate) fn join_below_root(root: &[u8], levels_above_root: usize, relative: &[u8]) -> Vec<u8> {
    let kept = normalize(relative);
    let level = kept.iter().take_while(|&&segment| segment == b"..").count();
    let folder = spell_folder_above_root(root, levels_above_root, level);
    [&folder[..], &kept[level..].join(&b"/"[..])].concat()
}

fn without_trailing_slashes(path: &[u8]) -> &[u8] {
    let end = path.iter().rposition(|&byte| byte != b'/');
    &path[..end.map_or(0, |last| last + 1)]
}

/// Returns `text` and what is left of it behind the last folders of the root directory.
fn spell_from_root(root_directory: &[u8], text: &[u8]) -> Vec<Vec<u8>> {
    let named = normalize(text);
    let folders = normalize(root_directory);
    let mut spelled = vec![text.to_vec()];
    for count in 1..named.len().min(folders.len() + 1) {
        if folders.ends_with(&named[..count]) {
            spelled.push([b"./", &named[count..].join(&b"/"[..])[..]].concat());
        }
    }
    spelled
}

pub(crate) fn name_from_working_directory(relative: &[u8]) -> Vec<u8> {
    [b"./", &normalize(relative).join(&b"/"[..])[..]].concat()
}

pub(crate) fn spell_root_of_executable(paths: &PathOptions) -> Vec<u8> {
    let prefix = paths.module_prefix.iter();
    prefix
        .map(|&byte| if byte == b'\\' { b'/' } else { byte })
        .collect()
}

fn borrow_name(name: &NameKnownInPart) -> (&[u8], Option<&[u8]>) {
    (&name.0[..], name.1.as_deref())
}

fn spell_names(
    code: &dyn CodeView<'_>,
    file: FileId,
    name: &ImportSpecifier,
) -> Vec<NameKnownInPart> {
    let text_of = |atom| code.atoms().bytes(atom).to_vec();
    let alternatives = code.analysis(file).alternatives_of(name).iter();
    alternatives
        .filter_map(|alternative| match *alternative {
            ImportSpecifier::Constant(text) => Some((text_of(text), None)),
            ImportSpecifier::Pattern { prefix, suffix } => {
                Some((text_of(prefix), Some(text_of(suffix))))
            }
            ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => None,
        })
        .collect()
}

fn find_loaded_file(code: &dyn CodeView<'_>, importer: FileId, site: u32) -> Option<FileId> {
    match *code.answers(importer)?.0.get(site as usize)? {
        CodeAnswer::File(file) => Some(file),
        _ => None,
    }
}

fn find_embedded_file(code: &dyn CodeView<'_>, importer: FileId, site: u32) -> Option<Named> {
    let &CodeAnswer::File(copy) = code.answers(importer)?.0.get(site as usize)? else {
        return None;
    };
    describe_embedded_file(code, copy)
}

fn describe_embedded_file(code: &dyn CodeView<'_>, copy: FileId) -> Option<Named> {
    let source = parsed_source_in(code, copy)?;
    let is_copy = source.kind == SourceKind::Data
        && source.loader == Loader::File
        && source.plugin_module.is_none();
    if !is_copy {
        return None;
    }
    let hir = code.hir(copy);
    let path_of_copy = hir.ids(hir.body).find_map(|statement| {
        let StmtKind::ExportDefault(value) = hir[statement].kind else {
            return None;
        };
        match hir[value].kind {
            ExprKind::String(path) => Some(code.atoms().bytes(path).to_vec()),
            _ => None,
        }
    })?;
    Some(Named::File {
        path: code.file_name(copy).to_vec(),
        path_of_copy: Some(path_of_copy),
    })
}

fn count_as_sure(entry_points: &mut [(Vec<u8>, FoundEntryPoint)], key: &[u8]) {
    for (_, entry_point) in entry_points.iter_mut().filter(|it| it.0 == key) {
        if entry_point.because == FoundBecause::MayStartWorker {
            entry_point.because = FoundBecause::StartsWorker;
        }
    }
}

fn collect_named_workers(
    files: &Files<'_>,
    is_followed: impl Fn(Named) -> bool,
) -> Vec<(FileId, ExprId)> {
    let mut workers = Vec::new();
    let mut compiled = files.compiled_files().iter();
    let stores_path_of_parameter = compiled.any(|&file| {
        parsed_source_in(files, file).is_some_and(|it| it.contents.stores_path_of_parameter)
    });
    for &file in files.compiled_files() {
        let Some(source) = parsed_source_in(files, file) else {
            continue;
        };
        let contents = &source.contents;
        let loses_paths =
            stores_path_of_parameter && files.bound(file).import_meta_may_be_modified();
        let starts = contents.worker_starts.iter();
        let starts = starts.filter(|start| start.place == PlaceOfName::Constructor);
        let followed = starts.filter(|start| {
            let mut names = files.analysis(file).alternatives_of(&start.name).iter();
            let has_unknown_name = start.form != WorkerNameForm::OwnFile
                && names.any(|name| *name == ImportSpecifier::Unknown);
            !has_unknown_name
                && !(start.is_on_trust && loses_paths)
                && Mention::of_start(files, file, start)
                    .is_some_and(|mention| is_followed(mention.named))
        });
        workers.extend(followed.map(|start| (file, start.at)));
        let of_code = contents.known_code_workers.iter();
        workers.extend(of_code.map(|&at| (file, at)));
    }
    workers
}

/// Returns the constructions with known names, for a load that looks for no entry points.
pub(crate) fn find_named_workers(files: &Files<'_>) -> Vec<(FileId, ExprId)> {
    collect_named_workers(files, |_| true)
}

impl Mention {
    fn of_start(code: &dyn CodeView<'_>, file: FileId, start: &WorkerStart) -> Option<Mention> {
        let ask = |read_as: ReadAs| {
            let names = spell_names(code, file, &start.name);
            (!names.is_empty()).then(|| {
                Named::ByName(Question {
                    file_name: code.file_name(file).to_vec(),
                    read_as,
                    names,
                    is_guess: false,
                    is_written_elsewhere: start.place == PlaceOfName::Elsewhere,
                })
            })
        };
        let named = match start.form {
            WorkerNameForm::AsWritten => ask(ReadAs::EntryPoint),
            WorkerNameForm::FromOwnFolder => ask(ReadAs::PathFromOwnFolder),
            WorkerNameForm::OwnFile => Some(Named::File {
                path: code.file_name(file).to_vec(),
                path_of_copy: None,
            }),
            WorkerNameForm::Resolved(ResolvedForm::Path) => ask(ReadAs::Require),
            WorkerNameForm::Resolved(ResolvedForm::Url | ResolvedForm::UrlObject) => {
                ask(ReadAs::Url)
            }
            WorkerNameForm::EmbeddedFile(site) => find_embedded_file(code, file, site),
        };
        Some(Mention {
            named: named?,
            because: match start.place {
                PlaceOfName::Constructor | PlaceOfName::Preload => FoundBecause::StartsWorker,
                PlaceOfName::Elsewhere => FoundBecause::MayStartWorker,
            },
            started_at: Some((code.file_name(file).to_vec(), start.at.0)),
            named_by: None,
        })
    }
}

pub(crate) struct EntryPointFinder<'a, 'h> {
    input: FinderInput<'a, 'h>,
    code_from_root: CodeOptions,
    real_root: OnceLock<Vec<u8>>,
    is_case_sensitive: bool,
    found: Guarded<FoundSoFar>,
}

const _: fn() = || {
    fn is_shared<T: Sync>() {}
    is_shared::<EntryPointFinder<'static, 'static>>();
};

impl<'a, 'h> EntryPointFinder<'a, 'h> {
    pub(crate) fn new(input: FinderInput<'a, 'h>) -> EntryPointFinder<'a, 'h> {
        EntryPointFinder {
            code_from_root: CodeOptions {
                working_directory: from_native(&input.options.paths.root_directory),
                ..input.code.clone()
            },
            real_root: OnceLock::new(),
            is_case_sensitive: input.host.is_case_sensitive(),
            found: Guarded::new(FoundSoFar::default()),
            input,
        }
    }

    fn key_of(&self, path: &[u8]) -> Vec<u8> {
        to_path(path, self.is_case_sensitive).into_owned()
    }

    fn note_files_that_worker_may_start(&self, found: &FoundSoFar) {
        let named_for_more = &found.named_for_more_than_a_worker_that_may_start;
        let may_start: Vec<Vec<u8>> = (found.entry_points.iter())
            .filter(|it| it.1.because == FoundBecause::MayStartWorker)
            .filter(|it| !named_for_more.contains(&it.0))
            .map(|it| &it.1.source_path)
            .filter(|path| is_in_node_modules(path))
            .cloned()
            .collect();
        (self.input.host).note_files_of_packages_that_worker_may_start(&may_start);
    }

    fn collect_mentions(&self, code: &dyn CodeView<'_>, found: &FoundSoFar) -> Vec<Mention> {
        let mut mentions = Vec::new();
        let mut names_worker_constructor = false;
        let mut starts_out_of_sight = false;
        let mut embedded: Vec<FileId> = Vec::new();
        let mut starts: Vec<(FileId, &WorkerStart)> = Vec::new();
        let mut code_of_workers: BTreeMap<Option<usize>, CodeOfWorkers> = BTreeMap::new();
        let mut loads: FxHashMap<(Atom, u32), Vec<(FileId, bool)>> = FxHashMap::default();
        let mut sought: FxHashSet<(Atom, bool)> = FxHashSet::default();
        for &file in code.compiled_files() {
            let analysis = code.analysis(file);
            for &(name, argument, is_guess) in analysis.names_from_data_files {
                let mut sites = analysis.import_sites.iter();
                let site = sites.find(|site| site.specifier_node == argument);
                let requires = site.and_then(|site| match site.kind {
                    ImportSiteKind::Require(_) | ImportSiteKind::ImportMetaRequire(_) => Some(true),
                    ImportSiteKind::ImportCall(_) => Some(false),
                    _ => None,
                });
                let ways: &[Option<bool>] = match (requires, is_guess) {
                    (None, true) => &[Some(true), Some(false)],
                    (Some(true), _) => &[Some(true)],
                    (Some(false), _) => &[Some(false)],
                    (None, false) => &[None],
                };
                mentions.extend(ways.iter().map(|&requires| Mention {
                    named: Named::ByName(Question {
                        file_name: code.file_name(file).to_vec(),
                        read_as: match requires {
                            Some(true) => ReadAs::Require,
                            Some(false) | None => ReadAs::Import,
                        },
                        names: vec![(code.atoms().bytes(name).to_vec(), None)],
                        is_guess,
                        is_written_elsewhere: false,
                    }),
                    because: FoundBecause::NamedByData,
                    started_at: None,
                    named_by: requires.map(|requires| NamingLoad {
                        file,
                        written_in: file,
                        requires,
                        is_guess,
                        may_be_left_out: is_guess,
                    }),
                }));
            }
            let listed = analysis.names_resolved_from_listed_folders;
            for of_site in listed.chunk_by(|one, next| one.2 == next.2) {
                let own_folder = self.input.host.directory_of(code.file_name(file));
                let folders = of_site.iter().map(|it| {
                    let parts = [&own_folder[..], code.atoms().bytes(it.1)];
                    join_spill::<Posix>(&mut Vec::new(), &parts).to_vec()
                });
                let folders: Vec<Vec<u8>> = folders.collect();
                let name = code.atoms().bytes(of_site[0].0);
                let host = self.input.host;
                let package = bun_paths::is_package_path(name).then(|| {
                    let parts = if name.starts_with(b"@") { 2 } else { 1 };
                    let end = name.iter().enumerate().filter(|it| *it.1 == b'/');
                    &name[..end.map(|it| it.0).nth(parts - 1).unwrap_or(name.len())]
                });
                let holds_package = |folder: &[u8]| {
                    package.is_some_and(|it| host.is_dir(&[folder, b"/node_modules/", it].concat()))
                };
                let answers_from_above = |folder: &[u8]| {
                    let above = std::iter::successors(Some(folder), |&it| {
                        let end = strings::last_index_of_char(it, b'/')?;
                        (end > 0).then(|| &it[..end])
                    });
                    !holds_package(folder) && above.skip(1).any(holds_package)
                };
                if !folders
                    .iter()
                    .all(|it| host.is_dir(it) && !answers_from_above(it))
                {
                    let find_from =
                        |folder: &Vec<u8>| host.find_file_that_require_finds(folder, name);
                    let holds_it = |folder: &&Vec<u8>| {
                        host.is_dir(folder) && (package.is_none() || holds_package(folder))
                    };
                    if let Some(found) = folders.iter().find_map(find_from) {
                        let found_there = folders.iter().filter(holds_it).find_map(find_from);
                        host.note_resolve_whose_folders_bring_nothing(
                            ResolveWhoseFoldersBringNothing {
                                file: code.file_name(file).to_vec(),
                                written_at: of_site[0].2,
                                is_found_in_listed_folders_alone: found_there.as_ref()
                                    == Some(&found),
                                found_by_search_that_goes_on_above: found,
                            },
                        );
                    }
                    continue;
                }
                mentions.extend(folders.iter().map(|folder| Mention {
                    named: Named::ByName(Question {
                        file_name: [&folder[..], b"/asker"].concat(),
                        read_as: ReadAs::Require,
                        names: vec![(name.to_vec(), None)],
                        is_guess: false,
                        is_written_elsewhere: false,
                    }),
                    because: FoundBecause::NamedByData,
                    started_at: None,
                    named_by: None,
                }));
            }
            if let Some(source) = parsed_source_in(code, file) {
                let contents = &source.contents;
                names_worker_constructor |= contents.names_worker_constructor;
                starts_out_of_sight |=
                    contents.starts_worker_out_of_sight || contents.hands_worker_constructor_on;
                if source.loader == Loader::File {
                    embedded.push(file);
                }
                starts.extend(contents.worker_starts.iter().map(|start| (file, start)));
                let levels = self.input.host.levels_of_text(code.file_name(file));
                let held = code_of_workers.entry(levels).or_default();
                held.urls.extend_from_slice(&contents.urls_with_code);
                (held.texts).extend_from_slice(&contents.texts_behind_object_urls);
                sought.extend(contents.names.sought_from_unknown_folders.iter().copied());
                let arms = contents.names.written_arms_of_unknown_names.iter();
                let arms = arms.map(|&(name, requires)| (name, requires, false, false));
                let guessed = contents.names.guessed_arms.iter();
                let arms = arms.chain(guessed.map(|&name| (name, true, true, false)));
                let called_first = contents.names.arms_of_makers_called_first.iter();
                let arms = arms.chain(called_first.map(|&name| (name, true, false, true)));
                let followed = contents.names.followed_names.iter();
                let arms =
                    arms.chain(followed.map(|&(name, requires)| (name, requires, false, true)));
                mentions.extend(arms.map(|(name, requires, is_guess, yields_to_imports)| {
                    Mention {
                        named: Named::ByName(Question {
                            file_name: code.file_name(file).to_vec(),
                            read_as: match requires {
                                true => ReadAs::Require,
                                false => ReadAs::Import,
                            },
                            names: vec![(code.atoms().bytes(name).to_vec(), None)],
                            is_guess,
                            is_written_elsewhere: false,
                        }),
                        because: FoundBecause::WrittenInArm,
                        started_at: None,
                        named_by: Some(NamingLoad {
                            file,
                            written_in: file,
                            requires,
                            is_guess: is_guess || yields_to_imports,
                            may_be_left_out: is_guess,
                        }),
                    }
                }));
                for load in &contents.names.under_parameters {
                    let under_name = loads.entry((load.property, load.place)).or_default();
                    if under_name.last() != Some(&(file, load.requires)) {
                        under_name.push((file, load.requires));
                    }
                }
            }
        }
        let callers = match loads.is_empty() {
            true => &[][..],
            false => code.compiled_files(),
        };
        let callers = callers.iter();
        let callers = callers.filter_map(|&file| Some((file, parsed_source_in(code, file)?)));
        let passed = callers.flat_map(|(caller, source)| {
            let passed = source.contents.names.texts_passed_to_properties.iter();
            passed.map(move |passed| (caller, passed))
        });
        let mut loaders: FxHashMap<(Atom, u32, FileId), Vec<bool>> = FxHashMap::default();
        for (&(property, place), under_name) in &loads {
            for &(file, requires) in under_name {
                (loaders.entry((property, place, file)).or_default()).push(requires);
            }
        }
        let mut seen: FxHashSet<(Atom, u32, Atom, Option<FileId>)> = FxHashSet::default();
        for (caller, passed) in passed {
            let (property, place) = (passed.property, passed.place);
            if !loads.contains_key(&(property, place)) {
                continue;
            }
            let called = (passed.loaded_at).and_then(|site| find_loaded_file(code, caller, site));
            let is_whole = passed.loaded_at.is_some() && property == known::exports;
            if (passed.loaded_at.is_some() && called.is_none())
                || !seen.insert((property, place, passed.text, called))
            {
                continue;
            }
            let mut found: Vec<(FileId, bool)> = Vec::new();
            let mut gone_through: Vec<FileId> = Vec::new();
            let mut next = called;
            while let Some(file) = next.filter(|it| !gone_through.contains(it)) {
                gone_through.push(file);
                let requires = loaders.get(&(property, place, file)).into_iter().flatten();
                found.extend(requires.map(|&requires| (file, requires)));
                let source = parsed_source_in(code, file);
                let site = source.and_then(|it| it.contents.names.whole_exports_at);
                next = site.and_then(|site| find_loaded_file(code, file, site));
            }
            let is_guess = found.is_empty() && !is_whole;
            if is_guess {
                found.extend(loads.get(&(property, place)).into_iter().flatten());
            }
            found.shared_sort_unstable();
            found.dedup();
            for (file, requires) in found {
                mentions.push(Mention {
                    named: Named::ByName(Question {
                        file_name: code.file_name(file).to_vec(),
                        read_as: match requires {
                            true => ReadAs::Require,
                            false => ReadAs::Import,
                        },
                        names: vec![(code.atoms().bytes(passed.text).to_vec(), None)],
                        is_guess,
                        is_written_elsewhere: false,
                    }),
                    because: FoundBecause::PassedForParameter,
                    started_at: None,
                    named_by: Some(NamingLoad {
                        file,
                        written_in: caller,
                        requires,
                        is_guess,
                        may_be_left_out: false,
                    }),
                });
            }
        }
        let callers = match sought.is_empty() {
            true => &[][..],
            false => code.compiled_files(),
        };
        let mut folders: FxHashSet<&[u8]> = FxHashSet::default();
        for &file in callers {
            let file_name = code.file_name(file);
            let end = strings::last_index_of_char(file_name, b'/').unwrap_or(0);
            if !folders.insert(&file_name[..end]) {
                continue;
            }
            mentions.extend(sought.iter().map(|&(name, requires)| Mention {
                named: Named::ByName(Question {
                    file_name: file_name.to_vec(),
                    read_as: match requires {
                        true => ReadAs::Require,
                        false => ReadAs::Import,
                    },
                    names: vec![(code.atoms().bytes(name).to_vec(), None)],
                    is_guess: false,
                    is_written_elsewhere: false,
                }),
                because: FoundBecause::PassedForParameter,
                started_at: None,
                named_by: None,
            }));
        }
        if names_worker_constructor {
            let is_elsewhere = |it: &(FileId, &WorkerStart)| it.1.place == PlaceOfName::Elsewhere;
            let (elsewhere, sure): (Vec<_>, Vec<_>) = starts.into_iter().partition(is_elsewhere);
            let sure = sure.into_iter();
            mentions.extend(sure.filter_map(|(file, start)| Mention::of_start(code, file, start)));
            if starts_out_of_sight {
                let elsewhere = elsewhere.into_iter();
                let written = elsewhere.filter_map(|it| Mention::of_start(code, it.0, it.1));
                mentions.extend(written);
                let embedded = embedded.into_iter();
                let embedded = embedded.filter_map(|copy| describe_embedded_file(code, copy));
                mentions.extend(embedded.map(|named| Mention {
                    named,
                    because: FoundBecause::MayStartWorker,
                    started_at: None,
                    named_by: None,
                }));
            }
            for (levels, held) in code_of_workers {
                mentions.append(&mut self.mention_code_of_workers(code, found, levels, held));
            }
        }
        // A name made at run time gets the module that a written URL has loaded. With =strict it gets none.
        if !self.is_strict() {
            let urls = self.input.host.data_urls_in_program().into_iter();
            mentions.extend(urls.map(|url| Mention {
                named: Named::Url { url, levels: None },
                because: FoundBecause::NamedByData,
                started_at: None,
                named_by: None,
            }));
        }
        if !self.input.options.load.runs_tests {
            let followed = find_files_followed_further_than_bundler(code).into_iter();
            mentions.extend(followed.map(|path| Mention {
                named: Named::File {
                    path,
                    path_of_copy: None,
                },
                because: FoundBecause::FollowedFurtherThanBundler,
                started_at: None,
                named_by: None,
            }));
        }
        mentions.retain(|mention| match &mention.named {
            Named::ByName(question) => !found.asked.contains_key(question),
            Named::File { .. } | Named::Url { .. } | Named::Text { .. } => true,
        });
        mentions
    }

    fn is_strict(&self) -> bool {
        let level = self.input.options.aot.code_generation_from_strings;
        level == CodeGenerationFromStrings::Strict
    }

    fn mention_code_of_workers(
        &self,
        code: &dyn CodeView<'_>,
        found: &FoundSoFar,
        levels: Option<usize>,
        code_of_workers: CodeOfWorkers,
    ) -> Vec<Mention> {
        // With =strict no Worker starts from text.
        if self.is_strict() {
            return Vec::new();
        }
        let CodeOfWorkers { urls, texts } = code_of_workers;
        let is_unread = |name: &[u8]| !found.urls_read.contains(&(name.to_vec(), levels));
        let urls = urls.into_iter().map(|url| code.atoms().bytes(url));
        let unread = urls.filter(|&url| is_unread(url));
        let spellings = unread.flat_map(|url| {
            let said_by_object = self.input.host.write_url(url);
            [Some(url.to_vec()), said_by_object]
        });
        let spellings = spellings.flatten();
        let urls = spellings.map(|url| Named::Url { url, levels });
        let bytes = |text: Atom| code.atoms().bytes(text);
        let texts = texts.into_iter().filter_map(|(contents, r#type)| {
            let host = self.input.host;
            host.name_text_of_blob(bytes(contents), r#type.map(bytes))
        });
        let unread = texts.filter(|text| is_unread(&text.name));
        let named = urls.chain(unread.map(|text| Named::Text { text, levels }));
        named
            .map(|named| Mention {
                named,
                because: FoundBecause::StartsWorker,
                started_at: None,
                named_by: None,
            })
            .collect()
    }

    fn mention_code_that_holds_paths_above_root(
        &self,
        code: &dyn CodeView<'_>,
        found: &FoundSoFar,
        levels: usize,
    ) -> Vec<Mention> {
        let files = code.compiled_files().iter();
        let sources = files.filter_map(|&file| parsed_source_in(code, file));
        let held = sources.flat_map(|it| &it.contents.code_by_levels_above_root);
        let mut of_levels = CodeOfWorkers::default();
        for &(_, text, r#type) in held.filter(|it| it.0 == levels) {
            match r#type {
                None => of_levels.urls.push(text),
                Some(r#type) => of_levels.texts.push((text, r#type)),
            }
        }
        self.mention_code_of_workers(code, found, Some(levels), of_levels)
    }

    fn settle_levels_above_root(
        &self,
        code: &dyn CodeView<'_>,
        found: &mut FoundSoFar,
    ) -> (Vec<Vec<u8>>, Vec<Mention>) {
        let host = self.input.host;
        let settled = host.levels_above_root();
        let named = match host.highest_level_named() {
            0 => 0,
            highest => highest + 1,
        };
        if found.code_of_levels.is_empty() && settled.is_none() && named == 0 {
            return Default::default();
        }
        let counted = count_levels_above_root(code, &self.input.options.paths);
        if found.code_of_levels.is_empty() && settled.is_none() && named <= counted {
            return Default::default();
        }
        let levels = counted.max(named).max(settled.unwrap_or(0));
        host.settle_levels_above_root(levels);
        let begun = take(&mut found.code_of_levels).into_iter();
        let (kept, dropped): (Vec<_>, Vec<_>) = begun.partition(|it| it.0 == levels);
        found.code_of_levels = kept;
        let file_names = code.compiled_files().iter().map(|&it| code.file_name(it));
        match dropped.is_empty() {
            true => {
                let reach: FxHashSet<&[u8]> = file_names.collect();
                let mut in_front = take(&mut found.reach_in_front_of_drop).into_iter();
                if let Some(lost) = in_front.find(|it| !reach.contains(&it[..])) {
                    host.note_file_lost_with_texts_of_other_levels(lost);
                }
            }
            false => {
                let others = file_names.filter(|it| host.levels_of_text(it).is_none());
                found.reach_in_front_of_drop = others.map(<[u8]>::to_vec).collect();
            }
        }
        for (_, name, _) in &dropped {
            found.texts_in_program.remove(name);
        }
        let dropped = dropped.into_iter().map(|it| it.2).collect();
        let mentions = self.mention_code_that_holds_paths_above_root(code, found, levels);
        (dropped, mentions)
    }

    fn builds_outside_root(&self) -> bool {
        !self.input.options.aot.runs_in_place
            && self.input.code.working_directory != self.code_from_root.working_directory
    }

    fn look_from(&self, directory: &[u8], names: &[(&[u8], Option<&[u8]>)]) -> Vec<Vec<u8>> {
        let (host, code) = (self.input.host, self.input.code);
        match names {
            [] => Vec::new(),
            _ => resolve_names_known_in_part(host, code, directory, names).unwrap_or_default(),
        }
    }

    fn find_file_written_as_entry_point(
        &self,
        finders: &FileFinders<'_>,
        file_name: &[u8],
        text: &[u8],
    ) -> Option<NamedFile> {
        let Options { aot, paths, .. } = self.input.options;
        let from_here = |written: &[u8]| finders.from_working_directory().find_entry_point(written);
        let from_root = |written: &[u8]| finders.from_root_directory().find_entry_point(written);
        let is_bare = is_bare_name(text);
        if aot.runs_in_place {
            return match is_bare {
                true => from_root(text).map(NamedFile::at),
                false => from_here(text).map(NamedFile::at),
            };
        }
        let root = spell_root_of_executable(paths);
        let levels = count_folders(&paths.root_directory);
        let is_written_down = !names_directory(text);
        if let Some(on_disk) = (self.input.host).find_file_named_as_in_executable(file_name, text) {
            let path = match text.starts_with(b"file:") {
                true => read_file_url(text)?,
                false => text.to_vec(),
            };
            let written_down_as = match path.strip_prefix(&root[..]) {
                Some(below_root) => join_below_root(&root, levels, below_root),
                None => {
                    let read_by = self.input.host.levels_above_root_seen_from(file_name);
                    spell_with_other_levels(&root, &path, read_by, levels)
                }
            };
            return Some(NamedFile {
                path: from_here(&on_disk)?,
                written_down_as: is_written_down.then_some(written_down_as),
            });
        }
        if !is_bare && !is_relative_path(text) {
            return from_here(text).map(NamedFile::at);
        }
        let below_root = from_root(text);
        let elsewhere = match is_written_down && self.builds_outside_root() {
            true => from_here(text).filter(|path| below_root.as_ref() != Some(path)),
            false => None,
        };
        let is_from_here = elsewhere.is_some();
        let path = elsewhere.or(below_root)?;
        if !is_written_down {
            return Some(NamedFile::at(path));
        }
        let find = |written: &[u8]| match is_from_here {
            true => from_here(written),
            false => from_root(written),
        };
        let is_of_package = is_bare && find(&[b"./", text].concat()).as_ref() != Some(&path);
        let looked_for = match is_of_package {
            true => [b"node_modules/", text].concat(),
            false => text.to_vec(),
        };
        let written_down_as = match is_from_here {
            true => name_from_working_directory(&looked_for),
            false => join_below_root(&root, levels, &looked_for),
        };
        Some(NamedFile {
            path,
            written_down_as: Some(written_down_as),
        })
    }

    fn lies_in_root(&self, path: &[u8]) -> bool {
        let root = &self.code_from_root.working_directory[..];
        let real_root = self
            .real_root
            .get_or_init(|| self.input.host.realpath(root));
        let real_path = self.input.host.realpath(path);
        [path, &real_path].into_iter().all(|path| {
            let path = self.key_of(path);
            [root, &real_root[..]].into_iter().any(|root| {
                let root = self.key_of(without_trailing_slashes(root));
                path.strip_prefix(&root[..])
                    .is_some_and(|below| below.starts_with(b"/"))
            })
        })
    }

    /// Finds the file of the root directory that a relative text is the name of, whatever the working directory is. A file that
    /// the program holds already may lie elsewhere.
    fn find_file_in_root(
        &self,
        code: &dyn CodeView<'_>,
        finders: &FileFinders<'_>,
        mention: &NameLeftOut,
        names_left_out: &mut Vec<NameLeftOut>,
    ) -> Option<NamedFile> {
        let text = &mention.name[..];
        let paths = &self.input.options.paths;
        let from_root = finders.from_root_directory();
        let may_lead_to = |path: &[u8]| {
            let key = self.key_of(path);
            let mut held = code.compiled_files().iter();
            self.lies_in_root(path) || held.any(|&it| self.key_of(code.file_name(it)) == key)
        };
        let root = from_native(&paths.root_directory);
        let mut spellings = spell_from_root(&root, text);
        let main = code.entry_points().first();
        let main = main.map(|&main| self.input.host.directory_of(code.file_name(main)));
        spellings.extend(main.map(|folder| [&folder[..], b"/", text].concat()));
        let mut outside = None;
        for spelled in spellings {
            let Some(on_disk) = from_root.find_entry_point_on_disk(&spelled) else {
                continue;
            };
            if !may_lead_to(&on_disk) {
                outside.get_or_insert(on_disk);
                continue;
            }
            let Some(path) = from_root.find_guessed_entry_point(&spelled) else {
                names_left_out.push(NameLeftOut {
                    because: LeftOutBecause::KeptOutByPlugin,
                    leads_to: on_disk,
                    ..mention.clone()
                });
                return None;
            };
            if !may_lead_to(&path) {
                outside.get_or_insert(path);
                continue;
            }
            let root = spell_root_of_executable(paths);
            let levels = count_folders(&paths.root_directory);
            let written_down_as = match spelled == text {
                true => join_below_root(&root, levels, text),
                false => name_from_working_directory(text),
            };
            return Some(NamedFile {
                path,
                written_down_as: (!names_directory(text)).then_some(written_down_as),
            });
        }
        let outside = outside.or_else(|| {
            let above = std::iter::successors(Some(&root[..]), |&folder| {
                let end = strings::last_index_of_char(folder, b'/')?;
                (end > 0).then(|| &folder[..end])
            });
            let mut above = above.skip(1);
            above.find_map(|folder| {
                from_root.find_entry_point_on_disk(&[folder, b"/", text].concat())
            })
        });
        names_left_out.extend(outside.map(|leads_to| NameLeftOut {
            leads_to,
            ..mention.clone()
        }));
        None
    }

    fn find_files_written_in_part_as_entry_points(
        &self,
        names: &[(&[u8], Option<&[u8]>)],
    ) -> Vec<NamedFile> {
        let here = &self.input.code.working_directory;
        let root_directory = &self.code_from_root.working_directory;
        let names = names.iter().copied();
        let (bare, paths): (Vec<_>, Vec<_>) = names.partition(|name| is_bare_name(name.0));
        let mut found = self.look_from(root_directory, &bare);
        found.append(&mut match self.input.options.aot.runs_in_place {
            true => self.look_from(here, &paths),
            false => self.look_from(root_directory, &paths),
        });
        let mut found: Vec<NamedFile> = found.into_iter().map(NamedFile::at).collect();
        if self.builds_outside_root() {
            let relative = paths.into_iter().filter(|name| is_relative_path(name.0));
            let relative: Vec<_> = relative.collect();
            let from_here = self.look_from(here, &relative).into_iter();
            found.extend(from_here.map(|path| {
                let written = compute_relative_path(to_native(here), to_native(&path));
                NamedFile {
                    written_down_as: written.map(|it| name_from_working_directory(&it)),
                    path,
                }
            }));
        }
        found
    }

    fn find_files_written_as_entry_points(
        &self,
        finders: &FileFinders<'_>,
        file_name: &[u8],
        names: &[NameKnownInPart],
    ) -> Vec<NamedFile> {
        let mut found = Vec::new();
        let mut known_in_part = Vec::new();
        for name in names {
            match name {
                (text, None) => {
                    found.extend(self.find_file_written_as_entry_point(finders, file_name, text));
                }
                (_, Some(_)) => known_in_part.push(borrow_name(name)),
            }
        }
        found.append(&mut self.find_files_written_in_part_as_entry_points(&known_in_part));
        found
    }

    fn join_as_executable_does(&self, directory: &[u8], text: &[u8]) -> Option<Vec<u8>> {
        let Options { aot, paths, .. } = self.input.options;
        if aot.runs_in_place {
            return None;
        }
        let below_root = compute_relative_path(&paths.root_directory, to_native(directory))?;
        (self.input.host).note_way_named(&[&below_root[..], b"/", text].concat());
        let root = spell_root_of_executable(paths);
        let levels = count_folders(&paths.root_directory);
        let folder = join_below_root(&root, levels, &below_root);
        let floor = usize::from(!root.starts_with(b"/"));
        let is_named = |folder: &&[u8]| !folder.is_empty();
        let mut kept: Vec<&[u8]> = strings::split(&folder, b"/").filter(is_named).collect();
        for segment in strings::split(text, b"/") {
            match segment {
                b"" | b"." => {}
                b".." if kept.len() > floor => {
                    kept.pop();
                }
                b".." => {}
                _ => kept.push(segment),
            }
        }
        let of_root: Vec<&[u8]> = strings::split(&root, b"/").filter(is_named).collect();
        let (&name_of_root, above_root) = of_root.split_last()?;
        let mount = kept.get(above_root.len()).copied();
        if kept.starts_with(above_root)
            && ![name_of_root, FOLDER_ABOVE_ROOT].map(Some).contains(&mount)
        {
            let place = above_root.len();
            kept.splice(
                place..place,
                core::iter::repeat_n(FOLDER_ABOVE_ROOT, levels),
            );
        }
        let start: &[u8] = if floor == 0 { b"/" } else { b"" };
        Some([start, &kept.join(&b"/"[..])].concat())
    }

    fn answer(&self, finders: &FileFinders<'_>, question: &Question) -> Vec<NamedFile> {
        let from_here = || finders.from_working_directory();
        let found = match (question.read_as, &question.names[..]) {
            (ReadAs::EntryPoint, names) => {
                let file_name = &question.file_name;
                return self.find_files_written_as_entry_points(finders, file_name, names);
            }
            (ReadAs::Import, [(text, None)]) => from_here().find_import(&question.file_name, text),
            (ReadAs::Require, [(text, None)]) => {
                from_here().find_required(&question.file_name, text)
            }
            (ReadAs::Url, [(text, None)]) => {
                let directory = self.input.host.directory_of(&question.file_name);
                let written_down_as = self.join_as_executable_does(&directory, text);
                let found = from_here().find_import(&question.file_name, text);
                let found = found.map(|path| NamedFile {
                    path,
                    written_down_as,
                });
                return found.into_iter().collect();
            }
            (ReadAs::PathFromOwnFolder | ReadAs::Url, names) => {
                let directory = &self.input.host.directory_of(&question.file_name);
                return (names.iter().map(borrow_name))
                    .flat_map(|name| {
                        let files = self.look_from(directory, &[name]).into_iter();
                        files.map(move |path| {
                            let text = match name {
                                (text, None) => Some(text.to_vec()),
                                (_, Some(_)) => compute_relative_path(directory, &path),
                            };
                            let text = text.as_deref();
                            NamedFile {
                                written_down_as: text
                                    .and_then(|text| self.join_as_executable_does(directory, text)),
                                path,
                            }
                        })
                    })
                    .collect();
            }
            (ReadAs::Import | ReadAs::Require, names) => {
                let names: Vec<_> = names.iter().map(borrow_name).collect();
                let directory = self.input.host.directory_of(&question.file_name);
                let found = self.look_from(&directory, &names).into_iter();
                return found.map(NamedFile::at).collect();
            }
        };
        found.into_iter().map(NamedFile::at).collect()
    }

    fn can_be_entry_point(
        &self,
        path: &[u8],
        because: FoundBecause,
        starts_worker_by_whole_name: bool,
    ) -> bool {
        let fits = match loader_named_by_path(&self.input.options.load.loaders, path) {
            Some(loader) => {
                script_kind_of(loader).is_some() || (gives_data(loader) && !because.is_for_worker())
            }
            None => {
                let name = &path[strings::last_index_of_char(path, b'/').map_or(0, |at| at + 1)..];
                starts_worker_by_whole_name
                    && !strings::contains_char(name, b'.')
                    && self.input.host.is_code(path)
            }
        };
        let is_file_on_disk = path.starts_with(b"/") && !is_host_path(path);
        fits && is_file_on_disk && !is_declaration_file_name(path)
    }

    fn write_down_names(
        &self,
        files: Vec<NamedFile>,
        because: FoundBecause,
        starts_worker_by_whole_name: bool,
        names_written: &mut Vec<EntryPointPaths>,
    ) -> Vec<Vec<u8>> {
        let mut paths = Vec::with_capacity(files.len());
        for file in files {
            let NamedFile {
                path,
                written_down_as,
            } = file;
            if let Some(public_path) = written_down_as
                .filter(|_| self.can_be_entry_point(&path, because, starts_worker_by_whole_name))
            {
                names_written.push(EntryPointPaths {
                    public_path,
                    source_path: source_path_of(&path),
                });
            }
            paths.push(path);
        }
        paths
    }

    fn may_get_contents_from_plugin(&self, path: &[u8]) -> bool {
        let host = self.input.host;
        host.is_plugin_source(path) || contains(&host.background_reads(), path)
    }

    fn find_name(
        &self,
        path: &[u8],
        path_of_copy: Option<&[u8]>,
        because: FoundBecause,
        starts_worker_by_whole_name: bool,
    ) -> Option<Vec<u8>> {
        let Options { aot, paths, .. } = self.input.options;
        if !self.can_be_entry_point(path, because, starts_worker_by_whole_name) {
            return None;
        }
        match path_of_copy {
            Some(copy) => {
                let below_root = copy.strip_prefix(&paths.module_prefix[..]);
                Some(below_root.unwrap_or(copy).to_vec())
            }
            None if aot.runs_in_place => Some(to_native(path).to_vec()),
            None => compute_relative_path(&paths.root_directory, to_native(path)),
        }
    }

    pub(crate) fn find(&self, code: &dyn CodeView<'_>) -> EntryPointsFound {
        let mut found = self.found.lock();
        let found = &mut *found;
        let Options { aot, paths, .. } = self.input.options;
        let mut mentions = self.collect_mentions(code, found);
        if code.is_only_asked_whether_more_is_named() {
            let told: FxHashSet<&[u8]> = found.entry_points.iter().map(|it| &it.0[..]).collect();
            let begun_at = code.entry_points().iter();
            let begun_at: FxHashSet<Vec<u8>> = begun_at
                .map(|&file| self.key_of(code.file_name(file)))
                .collect();
            let is_known = |key: Vec<u8>| told.contains(&key[..]) || begun_at.contains(&key);
            let settled = self.input.host.levels_above_root();
            let lies_above_folders =
                settled.is_some_and(|levels| count_levels_above_root(code, paths) > levels);
            let guessed = code.files_that_guesses_alone_bring().iter();
            let reaches_beyond_what_is_read = !guessed
                .filter_map(|&file| Some((file, parsed_source_in(code, file)?)))
                .all(|(file, source)| {
                    names_only_what_reaches_no_file(code, file, &source.builtins)
                });
            return EntryPointsFound {
                is_more_named: lies_above_folders
                    || reaches_beyond_what_is_read
                    || mentions.iter().any(|mention| match &mention.named {
                        Named::ByName(_) => true,
                        Named::File { path, .. } => {
                            let key = self.key_of(path);
                            found.merely_guessed.contains(&key) || !is_known(key)
                        }
                        Named::Url { url: name, .. }
                        | Named::Text {
                            text: EntryText { name, .. },
                            ..
                        } => !found.texts_in_program.contains(name),
                    }),
                ..EntryPointsFound::default()
            };
        }
        if !aot.runs_in_place {
            let deepest = count_folders(&paths.root_directory) + 2;
            let mut held = self.mention_code_that_holds_paths_above_root(code, found, deepest);
            mentions.append(&mut held);
        }
        let mut followed = self.follow(code, found, mentions);
        if followed.paths.is_empty() {
            let (dropped, mentions) = self.settle_levels_above_root(code, found);
            let mut code_of_workers = self.follow(code, found, mentions);
            followed.dropped = dropped;
            followed.paths = code_of_workers.paths;
            followed.named_by.append(&mut code_of_workers.named_by);
        }
        followed
    }

    fn follow(
        &self,
        code: &dyn CodeView<'_>,
        found: &mut FoundSoFar,
        mentions: Vec<Mention>,
    ) -> EntryPointsFound {
        if mentions.is_empty() {
            return EntryPointsFound::default();
        }
        let tables = [FileFinderTables::default(), FileFinderTables::default()];
        let finders = FileFinders {
            tables: &tables,
            host: self.input.host,
            code: [self.input.code, &self.code_from_root],
            finders: [OnceCell::new(), OnceCell::new()],
        };
        let begun_at = code.entry_points().iter();
        let mut known: FxHashSet<Vec<u8>> = begun_at
            .map(|&file| self.key_of(code.file_name(file)))
            .collect();
        known.extend(found.entry_points.iter().map(|it| it.0.clone()));
        let mut further: Vec<(Vec<u8>, Vec<u8>, FoundEntryPoint)> = Vec::new();
        let mut loads: Vec<(Vec<u8>, Option<NamingLoad>)> = Vec::new();
        for mention in mentions {
            let Mention {
                named,
                because,
                started_at,
                named_by,
            } = mention;
            let mut keys_of_answer = Vec::new();
            let mut starts_worker_by_whole_name = false;
            let (paths, path_of_copy, question) = match named {
                Named::ByName(question) if found.asked.contains_key(&question) => continue,
                Named::ByName(question) => {
                    let stays_in_root = question.is_written_elsewhere
                        && question.read_as == ReadAs::EntryPoint
                        && !self.input.options.aot.runs_in_place;
                    let files: Vec<NamedFile> = match stays_in_root {
                        true => {
                            let left_out = &mut found.names_left_out;
                            let written_at = started_at.as_ref().map_or(0, |it| it.1);
                            let texts = question.names.iter().filter(|name| name.1.is_none());
                            let files = texts.filter_map(|(text, _)| {
                                let mention = NameLeftOut {
                                    because: LeftOutBecause::LiesOutsideRoot,
                                    leads_to: Vec::new(),
                                    name: text.clone(),
                                    written_in: question.file_name.clone(),
                                    written_at,
                                };
                                self.find_file_in_root(code, &finders, &mention, left_out)
                            });
                            files.collect()
                        }
                        false => self.answer(&finders, &question),
                    };
                    let is_whole = question.names.iter().all(|name| name.1.is_none());
                    starts_worker_by_whole_name =
                        because == FoundBecause::StartsWorker && is_whole && !question.is_guess;
                    let whole = starts_worker_by_whole_name;
                    let written = &mut found.names_written;
                    let paths = self.write_down_names(files, because, whole, written);
                    (paths, None, Some(question))
                }
                Named::File {
                    path,
                    path_of_copy: Some(_),
                } if self.may_get_contents_from_plugin(&path) => continue,
                Named::File { path, path_of_copy } => (vec![path], path_of_copy, None),
                Named::Url { url, .. }
                | Named::Text {
                    text: EntryText { name: url, .. },
                    ..
                } if found.texts_in_program.contains(&url) => {
                    continue;
                }
                Named::Url { url, levels } => {
                    let is_first = found.urls_read.insert((url.clone(), levels));
                    if is_first && let Some(path) = self.input.host.begin_at_text(&url, levels) {
                        found.texts_in_program.insert(url.clone());
                        let begun = levels.map(|it| (it, url.clone(), path.clone()));
                        found.code_of_levels.extend(begun);
                        let entry_point = FoundEntryPoint {
                            source_path: url.clone(),
                            name: url,
                            because,
                            started_at,
                            starts: Vec::new(),
                            is_guess: false,
                        };
                        loads.push((path.clone(), named_by));
                        found.named_otherwise.insert(self.key_of(&path));
                        further.push((self.key_of(&path), path, entry_point));
                    }
                    continue;
                }
                Named::Text { text, levels } => {
                    let is_first = found.urls_read.insert((text.name.clone(), levels));
                    if is_first
                        && let Some(path) = self.input.host.begin_at_text_of_blob(&text, levels)
                    {
                        found.texts_in_program.insert(text.name.clone());
                        let begun = levels.map(|it| (it, text.name.clone(), path.clone()));
                        found.code_of_levels.extend(begun);
                        let entry_point = FoundEntryPoint {
                            source_path: text.name.clone(),
                            name: text.name,
                            because,
                            started_at,
                            starts: Vec::new(),
                            is_guess: false,
                        };
                        loads.push((path.clone(), named_by));
                        found.named_otherwise.insert(self.key_of(&path));
                        further.push((self.key_of(&path), path, entry_point));
                    }
                    continue;
                }
            };
            for path in paths {
                keys_of_answer.push(self.key_of(&path));
                if !because.is_for_worker() {
                    let named = &mut found.named_by_more_than_workers;
                    named.insert(self.key_of(&path));
                }
                if because == FoundBecause::MayStartWorker {
                    let named = &mut found.named_as_what_a_worker_may_start;
                    named.insert(self.key_of(&path));
                }
                if because != FoundBecause::MayStartWorker {
                    let named = &mut found.named_for_more_than_a_worker_that_may_start;
                    named.insert(self.key_of(&path));
                }
                if known.contains(&self.key_of(&path)) {
                    if because == FoundBecause::StartsWorker {
                        count_as_sure(&mut found.entry_points, &self.key_of(&path));
                    }
                    loads.push((path, named_by));
                    continue;
                }
                let whole = starts_worker_by_whole_name;
                let copy = path_of_copy.as_deref();
                let Some(name) = self.find_name(&path, copy, because, whole) else {
                    continue;
                };
                let entry_point = FoundEntryPoint {
                    source_path: source_path_of(&path),
                    name,
                    because,
                    started_at: started_at.clone(),
                    starts: Vec::new(),
                    is_guess: false,
                };
                let from_here = finders.from_working_directory();
                let begun_at = match because {
                    FoundBecause::MayStartWorker => {
                        from_here.find_guessed_entry_point(&entry_point.source_path)
                    }
                    _ => from_here.find_entry_point(&entry_point.source_path),
                };
                let Some(path) = begun_at else {
                    continue;
                };
                let key = self.key_of(&path);
                keys_of_answer.push(key.clone());
                loads.push((path.clone(), named_by));
                if !known.contains(&key) {
                    further.push((key, path, entry_point));
                }
            }
            if !because.is_for_worker() || started_at.is_none() {
                found.named_otherwise.extend(keys_of_answer.iter().cloned());
            }
            if let Some(question) = question {
                found.asked.insert(question, keys_of_answer);
            }
        }
        let guessed_before = found.merely_guessed.len();
        (found.merely_guessed).extend(further.iter().map(|it| it.0.clone()));
        for (path, load) in &loads {
            if !load.is_some_and(|load| load.may_be_left_out) {
                found.merely_guessed.remove(&self.key_of(path));
            }
        }
        if further.is_empty() && found.merely_guessed.len() == guessed_before {
            self.note_files_that_worker_may_start(found);
            return EntryPointsFound {
                paths: Vec::new(),
                dropped: Vec::new(),
                named_by: loads,
                is_more_named: false,
            };
        }
        further.shared_sort_unstable();
        further.dedup_by(|repeated, kept| repeated.0 == kept.0);
        let mut paths = Vec::with_capacity(further.len());
        let mut may_start = further.iter().map(|it| it.2.because);
        if may_start.any(|because| because == FoundBecause::MayStartWorker) {
            self.input.host.hold_failed_loads();
        }
        for (key, path, entry_point) in further {
            paths.push(path);
            found.entry_points.push((key, entry_point));
        }
        let source_paths: Vec<Vec<u8>> = (found.entry_points.iter())
            .filter(|it| !found.merely_guessed.contains(&it.0))
            .map(|it| &it.1.source_path)
            .filter(|path| !is_name_of_text(path))
            .cloned()
            .collect();
        self.input.host.begin_at(&source_paths);
        self.note_files_that_worker_may_start(found);
        EntryPointsFound {
            paths,
            dropped: Vec::new(),
            named_by: loads,
            is_more_named: false,
        }
    }

    pub(crate) fn take_excluded_names(&self) -> Vec<NameLeftOut> {
        let mut names = take(&mut self.found.lock().names_left_out);
        names.shared_sort_unstable();
        names.dedup_by(|repeated, kept| {
            (repeated.because, &repeated.leads_to) == (kept.because, &kept.leads_to)
        });
        names
    }

    pub(crate) fn take_names_written(&self) -> Vec<EntryPointPaths> {
        take(&mut self.found.lock().names_written)
    }

    pub(crate) fn finish(
        mut self,
        files: &Files<'_>,
        written_count: usize,
    ) -> (Vec<FoundEntryPoint>, Vec<(FileId, ExprId)>) {
        let found = take(self.found.get_mut());
        let told = found.entry_points.iter();
        let told: FxHashMap<&[u8], &FoundEntryPoint> = told
            .map(|(key, entry_point)| (&key[..], entry_point))
            .collect();
        let taken = files.entry_points().get(written_count..);
        let keys = taken.unwrap_or_default().iter();
        let keys: Vec<Vec<u8>> = keys
            .map(|&file| self.key_of(files.module(file).file_name()))
            .collect();
        let mut entry_points: Vec<FoundEntryPoint> = keys
            .iter()
            .map(|key| {
                let entry_point = told.get(&key[..]).copied();
                entry_point
                    .expect("the load begins at what it was given and at what it was told")
                    .clone()
            })
            .collect();
        self.list_starts(files, &found, &keys, &mut entry_points);
        for (key, entry_point) in keys.iter().zip(&mut entry_points) {
            entry_point.is_guess = entry_point.because == FoundBecause::MayStartWorker
                && !(found.named_for_more_than_a_worker_that_may_start).contains(key);
        }
        let followed_workers = self.list_followed_workers(files, &found);
        if crate::statistics::logs_stages() {
            let of_workers = entry_points.iter();
            let of_workers = of_workers.filter(|it| it.because.is_for_worker());
            crate::test_run_report::say_load_goes_on(of_workers.count());
        }
        (entry_points, followed_workers)
    }

    /// Returns the constructions whose known names led to entry points, and those that start from known code. A construction that may also get an unknown name isn't one of them.
    fn list_followed_workers(
        &self,
        files: &Files<'_>,
        found: &FoundSoFar,
    ) -> Vec<(FileId, ExprId)> {
        let begun_at = files.entry_points().iter();
        let begun_at: FxHashSet<Vec<u8>> = begun_at
            .map(|&file| self.key_of(files.module(file).file_name()))
            .collect();
        collect_named_workers(files, |named| match named {
            Named::ByName(question) => (found.asked.get(&question))
                .is_some_and(|keys| keys.iter().any(|key| begun_at.contains(key))),
            Named::File { path, .. } => begun_at.contains(&self.key_of(&path)),
            Named::Url { .. } | Named::Text { .. } => false,
        })
    }

    fn list_starts(
        &self,
        files: &Files<'_>,
        found: &FoundSoFar,
        keys: &[Vec<u8>],
        entry_points: &mut [FoundEntryPoint],
    ) {
        let places: FxHashMap<&[u8], usize> = (keys.iter().map(|key| &key[..]).zip(0..)).collect();
        let mut compiled = files.compiled_files().iter();
        let starts_out_of_sight = compiled.any(|&file| {
            parsed_source_in(files, file).is_some_and(|source| {
                let contents = &source.contents;
                contents.starts_worker_out_of_sight || contents.hands_worker_constructor_on
            })
        });
        for &file in files.compiled_files() {
            let Some(source) = parsed_source_in(files, file) else {
                return entry_points.iter_mut().for_each(|it| it.starts.clear());
            };
            let starts = source.contents.worker_starts.iter();
            let is_asked = |start: &&WorkerStart| match start.place {
                PlaceOfName::Constructor => true,
                PlaceOfName::Preload => false,
                PlaceOfName::Elsewhere => starts_out_of_sight,
            };
            for start in starts.filter(is_asked) {
                let own_key;
                let named = Mention::of_start(files, file, start).map(|mention| mention.named);
                let answer: &[Vec<u8>] = match &named {
                    Some(Named::ByName(question)) => match found.asked.get(question) {
                        Some(answer) => answer,
                        None => return entry_points.iter_mut().for_each(|it| it.starts.clear()),
                    },
                    Some(Named::File { path, .. }) => {
                        own_key = [self.key_of(path)];
                        &own_key
                    }
                    Some(Named::Url { .. } | Named::Text { .. }) | None => &[],
                };
                for place in answer.iter().filter_map(|key| places.get(&key[..])) {
                    let starts = &mut entry_points[*place].starts;
                    if starts.last() != Some(&(file, start.at.0)) {
                        starts.push((file, start.at.0));
                    }
                }
            }
        }
        for (key, entry_point) in keys.iter().zip(entry_points) {
            // A package's file that is held as a file and that sure starts name too waits for those starts. The reach seeds it
            // behind them, as what a Worker may start.
            let waits_though_held = entry_point.because.is_for_worker()
                && found.named_as_what_a_worker_may_start.contains(key)
                && is_in_node_modules(&entry_point.source_path)
                && !found.named_by_more_than_workers.contains(key);
            if waits_though_held {
                // Of two mentions of one file either reason may have stayed.
                entry_point.because = FoundBecause::MayStartWorker;
            }
            let is_named_otherwise = found.named_otherwise.contains(key) && !waits_though_held;
            if !entry_point.because.is_for_worker() || is_named_otherwise {
                entry_point.starts.clear();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_that_an_executable_looks_under_lies_below_its_root() {
        let rows: [(&[u8], &[u8]); 5] = [
            (b"./w.ts", b"/$bunfs/root/w.ts"),
            (b"./a/../lib//w", b"/$bunfs/root/lib/w"),
            (b"../lib/w.ts", b"/$bunfs/_.._/_.._/_.._/lib/w.ts"),
            (b"./a/../../../w.ts", b"/$bunfs/_.._/_.._/w.ts"),
            (
                b"node_modules/a-package",
                b"/$bunfs/root/node_modules/a-package",
            ),
        ];
        for (relative, expected) in rows {
            assert_eq!(join_below_root(b"/$bunfs/root/", 3, relative), expected);
        }
        assert_eq!(
            join_below_root(b"/$bunfs/root/", 1, b"../../w.ts"),
            b"/$bunfs/root/_.._/_.._/w.ts"
        );
        assert_eq!(
            name_from_working_directory(b"./src/../src/w.ts"),
            b"./src/w.ts"
        );
        assert_eq!(name_from_working_directory(b"../w.ts"), b"./../w.ts");
    }

    #[test]
    fn text_is_read_from_root_and_last_folders() {
        let rows: [(&[u8], &[u8], &[&[u8]]); 7] = [
            (b"/project/src", b"./w.ts", &[b"./w.ts"]),
            (b"/project/src", b"./src/w.ts", &[b"./src/w.ts", b"./w.ts"]),
            (
                b"/project/src/",
                b"./project//src/lib/w.ts",
                &[b"./project//src/lib/w.ts", b"./lib/w.ts"],
            ),
            (
                b"/a/a",
                b"./a/a/w.ts",
                &[b"./a/a/w.ts", b"./a/w.ts", b"./w.ts"],
            ),
            (b"/project/src", b"./project/w.ts", &[b"./project/w.ts"]),
            (b"C:/project", b"../project/w.ts", &[b"../project/w.ts"]),
            (b"/", b"../w.ts", &[b"../w.ts"]),
        ];
        for (root, text, expected) in rows {
            assert_eq!(spell_from_root(root, text), expected);
        }
    }

    #[test]
    fn root_of_an_executable_for_windows_is_spelled_with_forward_slashes() {
        let paths = |module_prefix: &[u8]| PathOptions {
            module_prefix: module_prefix.to_vec(),
            root_directory: b"/project".to_vec(),
            entry_point_names: Vec::new(),
            entry_point_file_names: Vec::new(),
        };
        assert_eq!(
            spell_root_of_executable(&paths(b"B:\\~BUN\\root\\")),
            b"B:/~BUN/root/"
        );
        assert_eq!(
            spell_root_of_executable(&paths(b"/$bunfs/root/")),
            b"/$bunfs/root/"
        );
    }

    #[test]
    fn text_is_a_path_or_the_name_of_a_package() {
        for text in [&b"./w.ts"[..], b"../w.ts"] {
            assert!(is_relative_path(text) && !is_bare_name(text), "{text:?}");
        }
        for text in [&b"w.ts"[..], b"a-package/w.js", b".hidden/w.js"] {
            assert!(!is_relative_path(text) && is_bare_name(text), "{text:?}");
        }
        assert!(!is_relative_path(b"/project/w.ts") && !is_bare_name(b"/project/w.ts"));
        for text in [&b"./pool/"[..], b"./pool/.", b"./pool/.."] {
            assert!(names_directory(text), "{text:?}");
        }
        assert!(!names_directory(b"./pool"));
    }
}
