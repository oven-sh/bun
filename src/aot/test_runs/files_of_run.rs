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
use bun_sema::hir::{ExprId, ExprKind, FileKind, PropKey, StmtId, StmtKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{ancestors, inside};
use bun_sema::session::Session;
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use bun_sema_driver::host::{from_argument, from_native, to_native};
use bun_sema_parser::{CompileParseOptions, parse_for_compile};
use bun_sys::Fd;

use super::texts::{inputs_of_file_that_nobody_describes, without_extension};
use super::{RunInput, WhoseFile};
use crate::ir::parallel::{InParallel, map_each};
use crate::load::contents::load_names::resolve_loads_through_imported_loaders;
use crate::load::sources::parsed_source;
use crate::load::{is_in_node_modules, read_file_bytes};
use crate::options::Options;

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

#[derive(Default)]
struct Manifests {
    ways_into_project: FxHashSet<Vec<u8>>,
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
                b"exports" => {
                    let mut nested = vec![field.value];
                    while let Some(value) = nested.pop() {
                        let way = text_of(value);
                        ways.extend(way.filter(|way| !strings::contains_char(way, b'*')));
                        nested.extend(fields_of(value).iter().map(|it| hir[it].value));
                        if let ExprKind::Array(items) = hir[value].kind {
                            nested.extend(hir.ids(items));
                        }
                    }
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

fn package_of(path: &[u8]) -> &[u8] {
    const FOLDER: &[u8] = b"/node_modules/";
    let Some(at) = strings::last_index_of(path, FOLDER) else {
        return b"";
    };
    let name = &path[at + FOLDER.len()..];
    let mut parts = strings::split(name, b"/");
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

struct CodeOnDisk<'a> {
    root: &'a [u8],
    in_memory_files: &'a [(Vec<u8>, Vec<u8>)],
    is_compiled: &'a (dyn Fn(&[u8]) -> bool + Sync),
    ways_into_project: &'a FxHashSet<Vec<u8>>,
    in_parallel: InParallel<'a>,
}

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
            ExprKind::String(text) if text.is_some() && is_relative(atoms.bytes(text)) => {
                let path = from_argument(folder, atoms.bytes(text));
                if !sited.contains(&path) {
                    written.paths.push((path, true));
                }
            }
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

fn find_last_word(file: &[u8]) -> &[u8] {
    match without_extension(basename(file)) {
        b"index" => basename(dirname::<Posix>(file)),
        word => word,
    }
}

fn may_write_path_to(text: &[u8], last_words: &FxHashSet<&[u8]>) -> bool {
    let mut parts = strings::split_any(text, b"/\"'`");
    parts.any(|part| last_words.contains(part) || last_words.contains(without_extension(part)))
}

fn find_importers_outside_run(disk: &CodeOnDisk<'_>, asked: &[Vec<u8>]) -> Vec<Option<Vec<u8>>> {
    let unread = list_code_that_run_does_not_reach(disk);
    let in_memory_files = disk.in_memory_files;
    let mut sought: Vec<Vec<u8>> = asked.to_vec();
    let mut is_imported = vec![false; sought.len()];
    let mut imports: Vec<Vec<(usize, bool)>> = vec![Vec::new(); sought.len()];
    let mut place_in_sought: Vec<Option<usize>> = vec![None; unread.len()];
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
        let mut sought_under: FxHashMap<&[u8], Vec<usize>> = FxHashMap::default();
        for place in round {
            let without = without_extension(&sought[place]);
            sought_under.entry(without).or_default().push(place);
            if let Some(folder) = without.strip_suffix(b"/index") {
                sought_under.entry(folder).or_default().push(place);
            }
        }
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
    let mut taken_by: Vec<Option<usize>> = vec![None; sought.len()];
    let roots = (asked.len()..sought.len())
        .filter(|&place| !is_imported[place] || disk.ways_into_project.contains(&sought[place]));
    let mut pending: Vec<usize> = roots.collect();
    while let Some(importer) = pending.pop() {
        for &(imported, takes_for_itself) in &imports[importer] {
            if (takes_for_itself || is_imported[importer]) && taken_by[imported].is_none() {
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

#[cfg(not(test))]
pub(crate) fn find_importer_outside_run(
    root: &[u8],
    file: &[u8],
    is_compiled: &(dyn Fn(&[u8]) -> bool + Sync),
) -> Option<Vec<u8>> {
    let no_ways = FxHashSet::default();
    let disk = CodeOnDisk {
        root: &from_native(root),
        ways_into_project: &no_ways,
        in_memory_files: &[],
        is_compiled: &|path| is_compiled(to_native(path)),
        in_parallel: &crate::ir::parallel::run_serially,
    };
    let importer = find_importers_outside_run(&disk, &[from_native(file)]).pop()??;
    Some(to_native(&importer).to_vec())
}

struct FilesByImports<'a, 's> {
    files: &'a Files<'s>,
    referrers: Vec<Vec<FileId>>,
    is_in_package: Vec<bool>,
    is_of_tests: Vec<bool>,
    manifests: Manifests,
}

impl FilesByImports<'_, '_> {
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

    fn find_files_that_product_comes_to(&self, stays: &[bool]) -> Vec<bool> {
        let files = self.files;
        let count = self.referrers.len();
        let runs = |index: usize| parsed_source(files, FileId(index as u32)).is_some();
        let imports_of = |index: usize| files.module(FileId(index as u32)).code_edges.iter();
        let mut is_imported = vec![false; count];
        for &file in files.entry_points() {
            is_imported[file.idx()] = true;
        }
        for index in (0..count).filter(|&index| runs(index)) {
            for target in imports_of(index).filter(|it| it.idx() != index) {
                is_imported[target.idx()] = true;
            }
        }
        let mut pending: Vec<usize> = (0..count)
            .filter(|&index| {
                let begins = stays[index] || self.is_in_package[index] || !is_imported[index];
                begins && !self.is_of_tests[index] && runs(index)
            })
            .collect();
        let mut is_come_to = vec![false; count];
        for &index in &pending {
            is_come_to[index] = true;
        }
        while let Some(index) = pending.pop() {
            for target in imports_of(index).map(|it| it.idx()) {
                if !self.is_of_tests[target] && !is_come_to[target] {
                    is_come_to[target] = true;
                    pending.push(target);
                }
            }
        }
        is_come_to
    }
    fn find_files_that_tests_alone_come_to(&self, stays: &[bool]) -> Vec<FileId> {
        let files = self.files;
        let count = self.referrers.len();
        let may_help =
            |index: usize| !self.is_in_package[index] && !self.is_of_tests[index] && !stays[index];
        let mut others = vec![0u32; count];
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
        names.loads_by_unknown_name
            || names.loads_by_unknown_path
            || !names.unknown_names_at.is_empty()
            || resolve_loads_through_imported_loaders(files, file)
    })
}

fn only_hands_names_on(files: &Files<'_>, file: FileId) -> bool {
    let hir = files.hir(file);
    let mut statements = hir
        .ids(hir.body)
        .map(|statement: StmtId| hir[statement].kind);
    statements.len() != 0
        && statements.all(|kind| match kind {
            StmtKind::ExportNamed(export) => hir[export].has_module_specifier,
            StmtKind::ExportStar { .. } => true,
            _ => false,
        })
}

fn asks_for_what_tests_are_given(files: &Files<'_>, file: FileId) -> bool {
    let Some(source) = parsed_source(files, file) else {
        return true;
    };
    let builtins = &source.builtins;
    loads_what_it_is_told(files, file)
        || source.of_run.runs_unseen_code
        || !builtins.replaced_members().is_empty()
        || !builtins.opened_holders().is_empty()
}

pub(crate) fn find_whose_files(input: &RunInput<'_, '_>) -> (Vec<WhoseFile>, Vec<bool>) {
    let (files, options) = (input.files, input.options);
    let count = files.modules.len();
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
    for file in compiled().filter(|file| !by_imports.is_in_package[file.idx()]) {
        by_imports.is_of_tests[file.idx()] |=
            parsed_source(files, file).is_none_or(|it| it.of_run.takes_from_test_runner);
    }
    let is_of_tests_by_itself = by_imports.is_of_tests.clone();
    let mut is_of_product_for_sure = vec![false; count];
    for file in by_imports.find_ways_into_product() {
        is_of_product_for_sure[file.idx()] = true;
    }
    let mut helpers = by_imports.find_files_that_tests_alone_come_to(&is_of_product_for_sure);
    let mut product_comes_to = by_imports.find_files_that_product_comes_to(&is_of_product_for_sure);
    let asked_of: Vec<FileId> = compiled()
        .filter(|file| {
            let index = file.idx();
            !product_comes_to[index]
                && !by_imports.is_in_package[index]
                && !by_imports.is_of_tests[index]
        })
        .collect();
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
            ways_into_project: &by_imports.manifests.ways_into_project,
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
            product_comes_to = by_imports.find_files_that_product_comes_to(&is_of_product_for_sure);
        }
    }
    let mut is_behind_helper = vec![false; count];
    for &file in &helpers {
        let mut referrers = by_imports.referrers[file.idx()].iter();
        is_behind_helper[file.idx()] = referrers.any(|it| {
            !by_imports.is_of_tests[it.idx()]
                && parsed_source(files, *it).is_some()
                && (is_behind_helper[it.idx()] || !only_hands_names_on(files, *it))
        });
    }
    helpers.retain(|file| {
        !is_behind_helper[file.idx()] || asks_for_what_tests_are_given(files, *file)
    });
    let behind_helpers = helpers
        .iter()
        .filter(|file| is_behind_helper[file.idx()])
        .count();
    for file in helpers {
        by_imports.is_of_tests[file.idx()] = true;
    }
    let FilesByImports {
        is_in_package,
        is_of_tests,
        manifests,
        ..
    } = by_imports;
    let own = compiled().filter(|file| {
        let index = file.idx();
        !is_of_tests[index] && !is_in_package[index] && product_comes_to[index]
    });
    let is_of_product =
        find_files_loaded_from(files, own.collect(), &|file| is_of_tests[file.idx()]);
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
