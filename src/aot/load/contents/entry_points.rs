use std::cell::OnceCell;
use std::collections::BTreeMap;
use std::mem::take;

use bun_ast::Loader;
use bun_core::strings;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::{ExprKind, StmtKind};
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
use crate::compile::EntryPointPaths;
use crate::load::externals::contains;
use crate::load::host::LoadHost;
use crate::load::loaders::{loader_named_by_path, script_kind_of};
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
    fn is_for_worker(self) -> bool {
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
    names_written: Vec<EntryPointPaths>,
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
            is_case_sensitive: input.host.is_case_sensitive(),
            found: Guarded::new(FoundSoFar::default()),
            input,
        }
    }

    fn key_of(&self, path: &[u8]) -> Vec<u8> {
        to_path(path, self.is_case_sensitive).into_owned()
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
            for &(name, argument) in analysis.names_out_of_data_files {
                let mut sites = analysis.import_sites.iter();
                let site = sites.find(|site| site.specifier_node == argument);
                let requires = site.and_then(|site| match site.kind {
                    ImportSiteKind::Require(_) | ImportSiteKind::ImportMetaRequire(_) => Some(true),
                    ImportSiteKind::ImportCall(_) => Some(false),
                    _ => None,
                });
                mentions.push(Mention {
                    named: Named::ByName(Question {
                        file_name: code.file_name(file).to_vec(),
                        read_as: match requires {
                            Some(true) => ReadAs::Require,
                            Some(false) | None => ReadAs::Import,
                        },
                        names: vec![(code.atoms().bytes(name).to_vec(), None)],
                        is_guess: false,
                    }),
                    because: FoundBecause::NamedByData,
                    started_at: None,
                    named_by: requires.map(|requires| NamingLoad {
                        file,
                        requires,
                        is_guess: false,
                    }),
                });
            }
            if let Some(source) = parsed_source_in(code, file) {
                let contents = &source.contents;
                names_worker_constructor |= contents.names_worker_constructor;
                starts_out_of_sight |=
                    contents.starts_worker_out_of_sight || contents.hands_worker_constructor_on;
                if source.loader == Loader::File && !is_in_node_modules(code.file_name(file)) {
                    embedded.push(file);
                }
                starts.extend(contents.worker_starts.iter().map(|start| (file, start)));
                let levels = self.input.host.levels_of_text(code.file_name(file));
                let held = code_of_workers.entry(levels).or_default();
                held.urls.extend_from_slice(&contents.urls_with_code);
                (held.texts).extend_from_slice(&contents.texts_behind_object_urls);
                sought.extend(contents.names.sought_from_unknown_folders.iter().copied());
                let arms = contents.names.written_arms_of_unknown_names.iter();
                let arms = arms.map(|&(name, requires)| (name, requires, false));
                let guessed = contents.names.guessed_arms.iter();
                let arms = arms.chain(guessed.map(|&name| (name, true, true)));
                mentions.extend(arms.map(|(name, requires, is_guess)| Mention {
                    named: Named::ByName(Question {
                        file_name: code.file_name(file).to_vec(),
                        read_as: match requires {
                            true => ReadAs::Require,
                            false => ReadAs::Import,
                        },
                        names: vec![(code.atoms().bytes(name).to_vec(), None)],
                        is_guess,
                    }),
                    because: FoundBecause::WrittenInArm,
                    started_at: None,
                    named_by: Some(NamingLoad {
                        file,
                        requires,
                        is_guess,
                    }),
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
                    }),
                    because: FoundBecause::PassedForParameter,
                    started_at: None,
                    named_by: Some(NamingLoad {
                        file,
                        requires,
                        is_guess,
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

    fn mention_code_of_workers(
        &self,
        code: &dyn CodeView<'_>,
        found: &FoundSoFar,
        levels: Option<usize>,
        code_of_workers: CodeOfWorkers,
    ) -> Vec<Mention> {
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

    fn is_named_as_code(&self, path: &[u8]) -> bool {
        let is_code = loader_named_by_path(&self.input.options.load.loaders, path)
            .is_some_and(|loader| script_kind_of(loader).is_some());
        let is_file_on_disk = path.starts_with(b"/") && !is_host_path(path);
        is_code && is_file_on_disk && !is_declaration_file_name(path)
    }

    fn write_down_names(
        &self,
        files: Vec<NamedFile>,
        names_written: &mut Vec<EntryPointPaths>,
    ) -> Vec<Vec<u8>> {
        let mut paths = Vec::with_capacity(files.len());
        for file in files {
            let NamedFile {
                path,
                written_down_as,
            } = file;
            if let Some(public_path) = written_down_as.filter(|_| self.is_named_as_code(&path)) {
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

    fn find_name(&self, path: &[u8], path_of_copy: Option<&[u8]>) -> Option<Vec<u8>> {
        let Options { aot, paths, .. } = self.input.options;
        if !self.is_named_as_code(path) {
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
            let (paths, path_of_copy, question) = match named {
                Named::ByName(question) if found.asked.contains_key(&question) => continue,
                Named::ByName(question) => {
                    let files = self.answer(&finders, &question);
                    let paths = self.write_down_names(files, &mut found.names_written);
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
                if known.contains(&self.key_of(&path)) {
                    if because == FoundBecause::StartsWorker {
                        count_as_sure(&mut found.entry_points, &self.key_of(&path));
                    }
                    loads.push((path, named_by));
                    continue;
                }
                let Some(name) = self.find_name(&path, path_of_copy.as_deref()) else {
                    continue;
                };
                let entry_point = FoundEntryPoint {
                    source_path: source_path_of(&path),
                    name,
                    because,
                    started_at: started_at.clone(),
                    starts: Vec::new(),
                };
                let from_here = finders.from_working_directory();
                let Some(path) = from_here.find_entry_point(&entry_point.source_path) else {
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
        if further.is_empty() {
            return EntryPointsFound {
                paths: Vec::new(),
                dropped: Vec::new(),
                named_by: loads,
            };
        }
        further.shared_sort_unstable();
        further.dedup_by(|repeated, kept| repeated.0 == kept.0);
        let mut paths = Vec::with_capacity(further.len());
        for (key, path, entry_point) in further {
            paths.push(path);
            found.entry_points.push((key, entry_point));
        }
        let source_paths: Vec<Vec<u8>> = (found.entry_points.iter())
            .map(|it| &it.1.source_path)
            .filter(|path| !is_name_of_text(path))
            .cloned()
            .collect();
        self.input.host.begin_at(&source_paths);
        EntryPointsFound {
            paths,
            dropped: Vec::new(),
            named_by: loads,
        }
    }

    pub(crate) fn take_names_written(&self) -> Vec<EntryPointPaths> {
        take(&mut self.found.lock().names_written)
    }

    pub(crate) fn finish(
        mut self,
        files: &Files<'_>,
        written_count: usize,
    ) -> Vec<FoundEntryPoint> {
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
        if crate::statistics::logs_stages() {
            let of_workers = entry_points.iter();
            let of_workers = of_workers.filter(|it| it.because.is_for_worker());
            crate::test_run_report::say_load_goes_on(of_workers.count());
        }
        entry_points
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
            if !entry_point.because.is_for_worker() || found.named_otherwise.contains(key) {
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
