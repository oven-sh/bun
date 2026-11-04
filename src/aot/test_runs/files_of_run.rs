//! Whose each file of a test run is. The runner says which files it starts: the test files and the preloads. From that list the rest follows by the imports.
//! Of the tests: the files of the list, what takes something from the test runner, what the preloads alone load, and a file of the project that the files of the tests alone import.
//! Of the product: every other file of the project, and whatever those load: an executable of the project holds them too, and they meet in the run what they meet there.
//! What a file is called, and the folder that it lies in, say nothing: `bun test ./checks/latest.ts`, `src/app.ts` beside `src/app.test.ts`.

use std::borrow::Cow;
use std::mem::replace;

use bun_ast::import_record::is_test_module;
use bun_core::strings;
use bun_js_parser::Jest;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::{basename, dirname};
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, Binding, RuntimeBindOptions};
use bun_sema::file_analysis::analyze_file;
use bun_sema::fold::{FoldInputs, FoldOptions};
use bun_sema::hir::{ExprId, ExprKind, FileKind, PropKey, StmtKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{ancestors, inside};
use bun_sema::session::Session;
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use bun_sema_driver::host::{from_argument, from_native, to_native};
use bun_sema_parser::{CompileParseOptions, parse_for_compile};
use bun_sys::Fd;

use super::texts::{inputs_of_file_that_nobody_describes, without_extension};
use super::{FoundInTexts, LeftOpenByText, RunInput, WhoseFile};
use crate::ir::parallel::{InParallel, map_each, run_serially};
use crate::load::contents::load_names::resolve_loads_through_imported_loaders;
use crate::load::sources::parsed_source;
use crate::load::{is_in_node_modules, read_file_bytes};
use crate::options::Options;

/// The files that `first` load, themselves included, and what those load in turn, by `FileId::idx()`. The search goes into no file that `stops` it.
pub(super) fn find_files_loaded_from(
    files: &Files<'_>,
    first: Vec<FileId>,
    stops: &dyn Fn(FileId) -> bool,
) -> Vec<bool> {
    let mut is_reached = vec![false; files.modules.len()];
    let mut pending = first;
    pending.retain(|file| !replace(&mut is_reached[file.idx()], true));
    while let Some(file) = pending.pop() {
        for &loaded in files.module(file).code_edges {
            if !stops(loaded) && !replace(&mut is_reached[loaded.idx()], true) {
                pending.push(loaded);
            }
        }
    }
    is_reached
}

/// The entry points that the build was given: what the runner starts.
pub(super) struct ListedByRunner {
    pub test_files: Vec<FileId>,
    pub preloads: Vec<FileId>,
}

pub(super) fn find_files_listed_by_runner(input: &RunInput<'_, '_>) -> ListedByRunner {
    let (files, options) = (input.files, input.options);
    let started_in = &options.code.working_directory;
    let preloads = options.load.paths_of_preloads.iter();
    let preloads: FxHashSet<FileId> = preloads
        .filter_map(|path| files.by_path.get(&from_argument(started_in, path)[..]))
        .collect();
    // The load has found the entry points behind those: a Worker starts there, or a name finds them.
    let written = files.entry_points().iter().copied();
    let written = written.take(options.entry_points.len());
    let (preloads, test_files) = written.partition(|file| preloads.contains(file));
    ListedByRunner {
        test_files,
        preloads,
    }
}

fn read_file(in_memory_files: &[(Vec<u8>, Vec<u8>)], path: &[u8]) -> Option<Vec<u8>> {
    let native = to_native(path);
    match in_memory_files.binary_search_by(|held| held.0[..].cmp(native)) {
        Ok(at) => Some(in_memory_files[at].1.clone()),
        Err(_) => read_file_bytes(path),
    }
}

/// What the package.json files above the test files say of the product: the nearest, and the root's in a workspace.
#[derive(Default)]
struct Manifests {
    /// The files that `main`, `module` and `bin` name, and `index.js` beside a manifest that names none.
    ways_into_project: FxHashSet<Vec<u8>>,
    /// The names under `dependencies`, `peerDependencies` and `optionalDependencies`: what the project says that it needs when it runs.
    packages_of_product: FxHashSet<Vec<u8>>,
}

impl Manifests {
    fn read(&mut self, folder: &[u8], text: &[u8]) {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let parse_options = CompileParseOptions {
            path: b"/manifest.js",
            script_kind: None,
            experimental_decorators: false,
            every_file_is_a_module: false,
            reads_jsdoc: false,
            ignores_pure_comments: false,
        };
        let literal = [b"(", text, b");"].concat();
        let hir = parse_for_compile(session.arena(), &parse_options, &literal, &atoms);
        let first = hir.ids(hir.body).next().filter(|_| !hir.has_errors);
        let Some(StmtKind::Expr(root)) = first.map(|statement| hir[statement].kind) else {
            return;
        };
        let fields_of = |object: ExprId| match hir[object].kind {
            ExprKind::Object(fields) => fields,
            _ => Default::default(),
        };
        let text_of = |value: ExprId| match hir[value].kind {
            ExprKind::String(text) => Some(atoms.bytes(text)),
            _ => None,
        };
        let mut ways: Vec<&[u8]> = Vec::new();
        for field in fields_of(root).iter().map(|field| hir[field]) {
            let PropKey::Name(name) = field.key else {
                continue;
            };
            let several = fields_of(field.value).iter().map(|it| hir[it]);
            match atoms.bytes(name) {
                b"main" | b"module" | b"bin" => {
                    ways.extend(text_of(field.value));
                    ways.extend(several.filter_map(|it| text_of(it.value)));
                }
                b"dependencies" | b"peerDependencies" | b"optionalDependencies" => {
                    let names = several.filter_map(|it| it.key.name());
                    (self.packages_of_product).extend(names.map(|it| atoms.bytes(it).to_vec()));
                }
                _ => {}
            }
        }
        if ways.is_empty() {
            ways.push(b"index.js");
        }
        for way in ways {
            let way = way.strip_prefix(b"./").unwrap_or(way);
            self.ways_into_project.insert(inside(folder, way));
        }
    }

    fn above_test_files(options: &Options<'_>) -> Manifests {
        let mut manifests = Manifests::default();
        let mut seen: FxHashSet<Vec<u8>> = FxHashSet::default();
        for test_file in &options.load.test_files {
            let test_file = from_argument(&options.code.working_directory, test_file);
            for folder in ancestors(dirname::<Posix>(&test_file)) {
                // What lies above it has been read with it.
                if !seen.insert(folder.to_vec()) {
                    break;
                }
                let path = inside(folder, b"package.json");
                if let Some(text) = read_file(&options.load.in_memory_files, &path) {
                    manifests.read(folder, &text);
                }
            }
        }
        manifests
    }
}

// The folder of the package that holds the file: `../node_modules/name` or `../node_modules/@scope/name`. Nothing for a file of the project itself.
fn package_of(path: &[u8]) -> &[u8] {
    const FOLDER: &[u8] = b"/node_modules/";
    let Some(at) = strings::last_index_of(path, FOLDER) else {
        return b"";
    };
    let name = &path[at + FOLDER.len()..];
    let mut parts = name.split(|&byte| byte == b'/');
    let first = parts.next().map_or(0, <[u8]>::len);
    let length = match name.starts_with(b"@") {
        true => first + 1 + parts.next().map_or(0, <[u8]>::len),
        false => first,
    };
    &path[..(at + FOLDER.len() + length).min(path.len())]
}

fn name_of_package(package: &[u8]) -> &[u8] {
    const FOLDER: &[u8] = b"/node_modules/";
    match strings::last_index_of(package, FOLDER) {
        Some(at) => &package[at + FOLDER.len()..],
        None => b"",
    }
}

struct Folder {
    files: Vec<Vec<u8>>,
    folders: Vec<Vec<u8>>,
}

// node_modules and folders whose names begin with a dot are left out.
fn list(path: &[u8]) -> Folder {
    let mut found = Folder {
        files: Vec::new(),
        folders: Vec::new(),
    };
    let flags = bun_sys::O::RDONLY | bun_sys::O::DIRECTORY;
    let Ok(folder) = bun_sys::openat(Fd::cwd(), &bun_core::ZBox::from_bytes(path), flags, 0) else {
        return found;
    };
    let _close = bun_sys::CloseOnDrop::new(folder);
    let mut entries = bun_sys::dir_iterator::iterate(folder);
    while let Ok(Some(entry)) = entries.next() {
        let name = entry.name.slice_u8();
        match entry.kind {
            bun_sys::EntryKind::File => found.files.push(name.to_vec()),
            bun_sys::EntryKind::Directory if name != b"node_modules" && !name.starts_with(b".") => {
                found.folders.push(name.to_vec());
            }
            _ => {}
        }
    }
    found
}

/// What the search on disk goes by. The paths are in the format of the checker.
struct CodeOnDisk<'a> {
    /// The folder that the runner was started in.
    root: &'a [u8],
    in_memory_files: &'a [(Vec<u8>, Vec<u8>)],
    /// Whether the run holds the file at the path.
    is_compiled: &'a (dyn Fn(&[u8]) -> bool + Sync),
    in_parallel: InParallel<'a>,
}

/// The files with code below the folder that the runner was started in, which the run does not compile. In the format of the checker, ascending. Each folder is listed once.
/// The load lists every file of the project of a tsconfig.json for the sake of its types: `src/main.ts`, which no test imports, is such a file, and no file of the run.
fn list_code_that_run_does_not_reach(disk: &CodeOnDisk<'_>) -> Vec<Vec<u8>> {
    let root = disk.root;
    let mut unread: Vec<Vec<u8>> = Vec::new();
    let mut folders = vec![root.to_vec()];
    while let Some(folder) = folders.pop() {
        let listed = list(to_native(&folder));
        folders.extend(listed.folders.iter().map(|name| inside(&folder, name)));
        unread.extend(listed.files.iter().map(|name| inside(&folder, name)));
    }
    let in_memory = disk.in_memory_files.iter();
    unread.extend(in_memory.map(|held| from_native(&held.0)).filter(|path| {
        let below = path.strip_prefix(root);
        below.is_some_and(|it| it.starts_with(b"/")) && !is_in_node_modules(path)
    }));
    unread.retain(|path| without_extension(path).len() < path.len() && !(disk.is_compiled)(path));
    unread.shared_sort_unstable();
    unread.dedup();
    unread
}

/// `./load`, `./load.ts`, `./load.js` for load.ts, and `.` or `./support` for support/index.ts.
fn spells(written: &[u8], file: &[u8]) -> bool {
    written == file
        || written == without_extension(file)
        || (without_extension(written) == without_extension(file)
            && [&b".js"[..], b".jsx", b".mjs", b".cjs"]
                .iter()
                .any(|it| written.ends_with(it)))
        || (without_extension(file).strip_suffix(b"/index")).is_some_and(|it| it == written)
}

#[derive(Default)]
struct Written {
    takes_from_test_runner: bool,
    /// With whether the file takes the module for itself: `export { load } from "./load"` does not.
    paths: Vec<(Vec<u8>, bool)>,
}

fn read_what_file_writes(path: &[u8], text: &[u8]) -> Written {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    let parse_options = CompileParseOptions {
        path,
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: false,
        ignores_pure_comments: false,
    };
    let text: &[u8] = arena.alloc_slice_copy(text);
    let mut hir = parse_for_compile(arena, &parse_options, text, &atoms);
    if matches!(hir.kind, FileKind::Json | FileKind::Declaration) {
        return Written::default();
    }
    hir.text = Cow::Borrowed(text);
    let fold = FoldInputs::new(FoldOptions::default(), arena);
    let bind_options = BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    };
    let file = inputs_of_file_that_nobody_describes();
    let (bound, analysis) = analyze_file(&mut hir, bind_options, &fold, file, &atoms, arena);
    let mut written = Written::default();
    let folder = dirname::<Posix>(path);
    let is_relative = |text: &[u8]| {
        text.starts_with(b"./") || text.starts_with(b"../") || text == b"." || text == b".."
    };
    for site in analysis.import_sites {
        let ImportSpecifier::Constant(specifier) = site.specifier else {
            continue;
        };
        let specifier = atoms.bytes(specifier);
        written.takes_from_test_runner |= is_test_module(specifier);
        if is_relative(specifier) {
            let exports_again = matches!(
                site.kind,
                ImportSiteKind::ExportFrom(_) | ImportSiteKind::ExportStar(_)
            );
            let path = from_argument(folder, specifier);
            written.paths.push((path, !exports_again));
        }
    }
    let sited: FxHashSet<Vec<u8>> = written.paths.iter().map(|it| it.0.clone()).collect();
    for (expression, node) in (0..).map(ExprId).zip(hir.exprs.iter()) {
        match node.kind {
            // `createRequire(import.meta.url)("./src/loads.cjs")`, `new URL("./worker.ts", import.meta.url)`.
            ExprKind::String(text) if text.is_some() && is_relative(atoms.bytes(text)) => {
                let path = from_argument(folder, atoms.bytes(text));
                if !sited.contains(&path) {
                    written.paths.push((path, true));
                }
            }
            // `bun test` hands every file the names of the test runner.
            ExprKind::Ident(name) if name.is_some() => {
                let is_free = !bound.ran_out_of_stack
                    && bound.is_evaluated_ident(expression)
                    && bound.binding(expression) == Binding::Free;
                let mut given = Jest::GLOBALS.iter();
                written.takes_from_test_runner |=
                    is_free && given.any(|it| it.as_bytes() == atoms.bytes(name));
            }
            _ => {}
        }
    }
    written
}

/// The last word of a path as an import writes it: `load` for load.ts, `support` for support/index.ts.
fn find_last_word(file: &[u8]) -> &[u8] {
    match without_extension(basename(file)) {
        b"index" => basename(dirname::<Posix>(file)),
        word => word,
    }
}

/// Whether the text holds one of the words as a part of a path: between slashes and quotes, with an extension or without. One pass over the text, however many words are sought.
fn may_write_path_to(text: &[u8], last_words: &FxHashSet<&[u8]>) -> bool {
    let mut parts = text.split(|&byte| matches!(byte, b'/' | b'"' | b'\'' | b'`'));
    parts.any(|part| last_words.contains(part) || last_words.contains(without_extension(part)))
}

/// For each of `asked`, a file on disk that imports it and is the product's: the run does not reach it, it takes nothing from the test runner, and neither does anybody on the way
/// down to it from a file that nobody imports. `main.ts` imports it, and no test imports `main.ts`. A fixture that only test files import, which this run does not hold, speaks for nothing.
/// Nor does a file that nobody imports and that only exports it again: such a file stands for whoever imports that file.
fn find_importers_outside_run(disk: &CodeOnDisk<'_>, asked: &[Vec<u8>]) -> Vec<Option<Vec<u8>>> {
    let unread = list_code_that_run_does_not_reach(disk);
    let in_memory_files = disk.in_memory_files;
    // The files that are asked for, and behind them each file on disk that comes to one of them and takes nothing from the test runner.
    let mut sought: Vec<Vec<u8>> = asked.to_vec();
    // By place in `sought`: whether somebody on disk imports the file, and the places of what it imports, with whether it takes that for itself.
    let mut is_imported = vec![false; sought.len()];
    let mut imports: Vec<Vec<(usize, bool)>> = vec![Vec::new(); sought.len()];
    // By place in `unread`.
    let mut place_in_sought: Vec<Option<usize>> = vec![None; unread.len()];
    // A file is parsed once, in the first round that seeks a name which it mentions.
    let mut written_by: Vec<Option<Written>> = unread.iter().map(|_| None).collect();
    let mut first_unread = 0;
    while first_unread < sought.len() && !unread.is_empty() {
        let round = first_unread..sought.len();
        first_unread = sought.len();
        let last_words = sought[round.clone()].iter();
        let last_words: FxHashSet<&[u8]> = last_words.map(|it| find_last_word(it)).collect();
        let read = |path: &Vec<u8>| -> Option<Written> {
            let text = read_file(in_memory_files, path)?;
            may_write_path_to(&text, &last_words).then(|| read_what_file_writes(path, &text))
        };
        let unparsed = unread.iter().zip(&written_by);
        let unparsed = unparsed.filter(|it| it.1.is_none()).map(|it| it.0);
        let mut parsed = map_each(unparsed.collect(), disk.in_parallel, &read).into_iter();
        for written in written_by.iter_mut().filter(|it| it.is_none()) {
            *written = parsed.next().flatten();
        }
        // The places in `sought`, by what an import may write for the file: its path without the extension, and the folder of an index file.
        let mut sought_under: FxHashMap<&[u8], Vec<usize>> = FxHashMap::default();
        for place in round {
            let without = without_extension(&sought[place]);
            sought_under.entry(without).or_default().push(place);
            if let Some(folder) = without.strip_suffix(b"/index") {
                sought_under.entry(folder).or_default().push(place);
            }
        }
        // The place in `unread` of who imports, the place in `sought` of what it imports, and whether it takes that for itself.
        let mut found: Vec<(usize, usize, bool)> = Vec::new();
        for (importer, written) in written_by.iter().enumerate() {
            for (spelled, takes_for_itself) in written.iter().flat_map(|it| &it.paths) {
                let shorter =
                    Some(without_extension(spelled)).filter(|it| it.len() < spelled.len());
                for under in [Some(&spelled[..]), shorter].into_iter().flatten() {
                    let places = sought_under.get(under).map_or(&[][..], Vec::as_slice);
                    let places = places
                        .iter()
                        .filter(|&&place| spells(spelled, &sought[place]));
                    found.extend(places.map(|&place| (importer, place, *takes_for_itself)));
                }
            }
        }
        // `true` comes behind `false`: the last way to a file says whether one of them takes it for itself.
        found.shared_sort_unstable();
        for (index, &(importer, imported, takes_for_itself)) in found.iter().enumerate() {
            let is_last_way =
                (found.get(index + 1)).is_none_or(|next| (next.0, next.1) != (importer, imported));
            if !is_last_way || place_in_sought[importer] == Some(imported) {
                continue;
            }
            is_imported[imported] = true;
            if (written_by[importer].as_ref()).is_none_or(|it| it.takes_from_test_runner) {
                continue;
            }
            let place = *place_in_sought[importer].get_or_insert_with(|| {
                sought.push(unread[importer].clone());
                is_imported.push(false);
                imports.push(Vec::new());
                sought.len() - 1
            });
            imports[place].push((imported, takes_for_itself));
        }
    }
    // Down from the files that nobody imports.
    let mut taken_by: Vec<Option<usize>> = vec![None; sought.len()];
    let roots = (asked.len()..sought.len()).filter(|&place| !is_imported[place]);
    let mut pending: Vec<usize> = roots.collect();
    while let Some(importer) = pending.pop() {
        for &(imported, takes_for_itself) in &imports[importer] {
            if (takes_for_itself || is_imported[importer]) && taken_by[imported].is_none() {
                // Who only exports it again stands for whoever imports that file.
                let through = taken_by[importer].filter(|_| !takes_for_itself);
                taken_by[imported] = Some(through.unwrap_or(importer));
                pending.push(imported);
            }
        }
    }
    let importers = taken_by[..asked.len()].iter();
    importers
        .map(|importer| importer.map(|place| sought[place].clone()))
        .collect()
}

/// For the runner, behind a run that has refused a load which `file` asked for: the file on disk that makes `file` the product's. Native paths.
#[cfg_attr(
    test,
    allow(dead_code, reason = "linked.rs calls it, which no test build holds")
)]
pub(crate) fn find_importer_outside_run(
    root: &[u8],
    file: &[u8],
    is_compiled: &(dyn Fn(&[u8]) -> bool + Sync),
) -> Option<Vec<u8>> {
    let disk = CodeOnDisk {
        root: &from_native(root),
        in_memory_files: &[],
        is_compiled: &|path| is_compiled(to_native(path)),
        in_parallel: &run_serially,
    };
    let importer = find_importers_outside_run(&disk, &[from_native(file).to_vec()]).pop()??;
    Some(to_native(&importer).to_vec())
}

/// What the search for the helpers of the tests asks.
struct FilesByImports<'a, 's> {
    files: &'a Files<'s>,
    /// By `FileId::idx()`.
    referrers: Vec<Vec<FileId>>,
    is_in_package: Vec<bool>,
    is_of_tests: Vec<bool>,
    manifests: Manifests,
}

impl FilesByImports<'_, '_> {
    /// What speaks for the product in the run itself: a way into the project that a manifest names, a file that nobody takes, and a file that a package imports.
    fn find_ways_into_product(&self) -> Vec<FileId> {
        let files = self.files;
        let mut is_entry_point = vec![false; self.referrers.len()];
        for &file in files.entry_points() {
            is_entry_point[file.idx()] = true;
        }
        let own = (0..self.referrers.len())
            .filter(|&index| !self.is_in_package[index] && !self.is_of_tests[index]);
        let ways = own.filter(|&index| {
            let referrers = &self.referrers[index];
            let is_taken = !referrers.is_empty() || is_entry_point[index];
            // Nothing runs a file that is read for its types alone.
            let runs_in_package = |referrer: &FileId| {
                self.is_in_package[referrer.idx()] && parsed_source(files, *referrer).is_some()
            };
            let name = files.module(FileId(index as u32)).file_name();
            !is_taken
                || self.manifests.ways_into_project.contains(name)
                || referrers.iter().any(runs_in_package)
        });
        ways.map(|index| FileId(index as u32)).collect()
    }

    /// The compiled files of the project whose every importer is a file of the tests or one of these. From the tests down: a ring of imports that somebody enters from outside it is
    /// never begun. `stays`: by `FileId::idx()`, what is none of them whoever imports it.
    fn find_files_that_tests_alone_come_to(&self, stays: &[bool]) -> Vec<FileId> {
        let files = self.files;
        let count = self.referrers.len();
        let may_help =
            |index: usize| !self.is_in_package[index] && !self.is_of_tests[index] && !stays[index];
        // By `FileId::idx()`: the importers that run and have yet to be found.
        let mut others = vec![0u32; count];
        // A Worker that a test starts begins at a file that nobody imports.
        let mut is_imported = vec![false; count];
        for &file in files.entry_points() {
            is_imported[file.idx()] = true;
        }
        for index in
            (0..count).filter(|&index| parsed_source(files, FileId(index as u32)).is_some())
        {
            let mut imported: Vec<FileId> = files.module(FileId(index as u32)).code_edges.to_vec();
            imported.sort_unstable();
            imported.dedup();
            for target in imported.into_iter().filter(|it| it.idx() != index) {
                is_imported[target.idx()] = true;
                others[target.idx()] += u32::from(!self.is_of_tests[index]);
            }
        }
        let first = files.compiled_files().iter().copied();
        let mut found: Vec<FileId> = first
            .filter(|file| {
                may_help(file.idx()) && is_imported[file.idx()] && others[file.idx()] == 0
            })
            .collect();
        let mut next = 0;
        while let Some(&file) = found.get(next) {
            next += 1;
            let mut imported: Vec<FileId> = files.module(file).code_edges.to_vec();
            imported.sort_unstable();
            imported.dedup();
            for target in imported.into_iter().filter(|&it| it != file) {
                others[target.idx()] -= 1;
                if others[target.idx()] == 0 && may_help(target.idx()) && files.is_compiled(target)
                {
                    found.push(target);
                }
            }
        }
        found
    }
}

fn loads_what_it_is_told(files: &Files<'_>, file: FileId) -> bool {
    parsed_source(files, file).is_some_and(|source| {
        let names = &source.contents.names;
        // `imports_given_unknown_names` lists every imported function that a call gives a value nobody reads. Few of them load.
        names.loads_by_unknown_name
            || names.loads_by_unknown_path
            || !names.unknown_names_at.is_empty()
            || resolve_loads_through_imported_loaders(files, file)
    })
}

/// What a file of the tests is given and a file of the product is not: it loads what nobody has compiled, its writes to the built-in objects are honored, and the texts that it holds
/// are read as code. A file that does none of that runs alike on either side, and on the side of the product it is compiled as the executable has it.
fn asks_for_what_tests_are_given(files: &Files<'_>, file: FileId) -> bool {
    let Some(source) = parsed_source(files, file) else {
        return true;
    };
    let says_something = |texts: &FoundInTexts| {
        texts.left_open != LeftOpenByText::Nothing
            || !texts.names_spied.is_empty()
            || !texts.modules_replaced.is_empty()
            || !texts.replaced_members.is_empty()
            || !texts.opened_holders.is_empty()
            || !texts.names_added.is_empty()
    };
    let (builtins, of_run) = (&source.builtins, &source.of_run);
    loads_what_it_is_told(files, file)
        || of_run.runs_unseen_code
        || !builtins.replaced_members().is_empty()
        || !builtins.opened_holders().is_empty()
        || says_something(&of_run.in_texts_written)
        || says_something(&of_run.in_texts_handed_on)
}

/// By `FileId::idx()`: whose each file is, and `ModuleFlags::LOADS_COMPILED_FILES_ALONE`.
pub(crate) fn find_whose_files(input: &RunInput<'_, '_>) -> (Vec<WhoseFile>, Vec<bool>) {
    let (files, options) = (input.files, input.options);
    let count = files.modules.len();
    // With `--aot-allow-code-from-disk` every file is read as the tests are.
    if !options.aot.only_tests_load_code_from_disk {
        return (vec![WhoseFile::OfTests; count], vec![false; count]);
    }
    let compiled = || files.compiled_files().iter().copied();
    let listed = find_files_listed_by_runner(input);
    let mut by_imports = FilesByImports {
        files,
        referrers: vec![Vec::new(); count],
        is_in_package: vec![false; count],
        is_of_tests: vec![false; count],
        manifests: Manifests::above_test_files(options),
    };
    for index in 0..count {
        let module = files.module(FileId(index as u32));
        by_imports.is_in_package[index] = is_in_node_modules(module.file_name());
        for target in module.edges.iter().chain(module.code_edges) {
            by_imports.referrers[target.idx()].push(FileId(index as u32));
        }
    }
    for &file in listed.test_files.iter().chain(&listed.preloads) {
        by_imports.is_of_tests[file.idx()] = true;
    }
    // No executable holds a file of the project that takes something from the test runner, wherever it lies. A package that asks `typeof jest` to find out where it runs
    // is given the name too, and the executable holds it.
    for file in compiled().filter(|file| !by_imports.is_in_package[file.idx()]) {
        by_imports.is_of_tests[file.idx()] |=
            parsed_source(files, file).is_none_or(|it| it.of_run.takes_from_test_runner);
    }
    let is_of_tests_by_itself = by_imports.is_of_tests.clone();
    // No executable holds a preload, nor what the preloads alone load: `import "./patch"` in setup/preload.ts.
    if !listed.preloads.is_empty() {
        let by_others = find_files_loaded_from(files, listed.test_files, &|_| false);
        let stops = |file: FileId| by_others[file.idx()];
        let by_preloads = find_files_loaded_from(files, listed.preloads, &stops);
        for index in (0..count).filter(|&index| by_preloads[index]) {
            by_imports.is_of_tests[index] |= !by_imports.is_in_package[index];
        }
    }
    // Nor a file of the project that the files of the tests alone import: `export const load = path => import(path)` in support/, beside tests/. Nor, of what only such files import,
    // however deep, a file that asks for what the tests are given: the helper that a fixture imports and that loads what the test has written. The rest of what lies deeper stays the
    // product's: where tests import the entry points of a program and no manifest names them, that is the program.
    // A file that somebody else imports too stays the product's, with whatever lies on a ring of imports with it. What speaks for the product stops the way down:
    // `find_ways_into_product`, and a file on disk.
    let mut is_of_product_for_sure = vec![false; count];
    for file in by_imports.find_ways_into_product() {
        is_of_product_for_sure[file.idx()] = true;
    }
    let asked_of = by_imports.find_files_that_tests_alone_come_to(&is_of_product_for_sure);
    let mut helpers = asked_of.clone();
    if !asked_of.is_empty() {
        let name_of = |file: FileId| files.module(file).file_name();
        let mut asked: Vec<Vec<u8>> = asked_of.iter().map(|&it| name_of(it).to_vec()).collect();
        asked.shared_sort_unstable();
        asked.dedup();
        let disk = CodeOnDisk {
            root: &options.code.working_directory,
            in_memory_files: &options.load.in_memory_files,
            is_compiled: &|path| {
                files
                    .by_path
                    .get(path)
                    .is_some_and(|it| files.is_compiled(it))
            },
            in_parallel: input.in_parallel,
        };
        let importers = find_importers_outside_run(&disk, &asked);
        let is_imported_outside_run = |file: &FileId| {
            let position = asked.binary_search_by(|it| it[..].cmp(name_of(*file)));
            position.is_ok_and(|position| importers[position].is_some())
        };
        let taken: Vec<FileId> = asked_of
            .into_iter()
            .filter(is_imported_outside_run)
            .collect();
        if !taken.is_empty() {
            for file in taken {
                is_of_product_for_sure[file.idx()] = true;
            }
            helpers = by_imports.find_files_that_tests_alone_come_to(&is_of_product_for_sure);
        }
    }
    let is_behind_helper = |file: &&FileId| {
        let mut referrers = by_imports.referrers[file.idx()].iter();
        referrers.any(|it| !by_imports.is_of_tests[it.idx()] && parsed_source(files, *it).is_some())
    };
    helpers.retain(|file| !is_behind_helper(&file) || asks_for_what_tests_are_given(files, *file));
    let behind_helpers = helpers.iter().filter(is_behind_helper).count();
    for file in helpers {
        by_imports.is_of_tests[file.idx()] = true;
    }
    let FilesByImports {
        is_in_package,
        is_of_tests,
        manifests,
        ..
    } = by_imports;
    let own = compiled().filter(|file| !is_of_tests[file.idx()] && !is_in_package[file.idx()]);
    let is_of_product =
        find_files_loaded_from(files, own.collect(), &|file| is_of_tests[file.idx()]);
    // No executable holds a package that only the tests themselves reach. webpack loads `ts-loader` by `require(loader.path)`, and so do babel, eslint and rollup load what a test
    // names for them. The file that writes such a load may leave the compiled files. The rest of the package stays as it is: nothing there asks to leave.
    // `src/main.ts` imports "@nestjs/core", and no test loads `src/main.ts`: what the project says that it needs when it runs is the product's.
    let package_of_file = |file: FileId| package_of(files.module(file).file_name());
    let first = compiled().filter(|&file| match is_in_package[file.idx()] {
        true => (manifests.packages_of_product).contains(name_of_package(package_of_file(file))),
        false => !is_of_tests_by_itself[file.idx()],
    });
    let reached = find_files_loaded_from(files, first.collect(), &|file| {
        is_of_tests_by_itself[file.idx()]
    });
    let reached = (0..count).filter(|&index| reached[index]);
    let packages_of_product: FxHashSet<&[u8]> = reached
        .map(|index| package_of_file(FileId(index as u32)))
        .collect();
    let mut whose = vec![WhoseFile::OfNeither; count];
    let mut loads_compiled_files_alone = vec![false; count];
    for file in compiled() {
        let index = file.idx();
        whose[index] = match (is_of_tests[index], is_of_product[index]) {
            (true, _) => WhoseFile::OfTests,
            (false, true) => WhoseFile::OfProduct,
            (false, false) => WhoseFile::OfNeither,
        };
        let loads_for_tests_alone = is_in_package[index]
            && !packages_of_product.contains(package_of_file(file))
            && loads_what_it_is_told(files, file);
        loads_compiled_files_alone[index] = !is_of_tests[index] && !loads_for_tests_alone;
    }
    let count_of = |side: WhoseFile| compiled().filter(|file| whose[file.idx()] == side).count();
    crate::test_run_report::say_whose_files(
        count_of(WhoseFile::OfTests),
        behind_helpers,
        count_of(WhoseFile::OfProduct),
        count_of(WhoseFile::OfNeither),
    );
    (whose, loads_compiled_files_alone)
}
