use std::borrow::Cow;
use std::cmp::Reverse;
use std::mem::replace;

use bun_ast::import_record::is_test_module;
use bun_core::strings;
use bun_js_parser::Jest;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::{basename, dirname};
use bun_sema::atom::{Atom, Interner, InternerPerThread, known};
use bun_sema::bind::{BindOptions, Binding, Bound, RuntimeBindOptions};
use bun_sema::file_analysis::{analyze_file, bind_file};
use bun_sema::fold::{FoldInputs, FoldOptions};
use bun_sema::hir::{Expr, ExprId, ExprKind, File, FileKind, MemberKey, PropKey, StmtId, StmtKind};
use bun_sema::import_sites::{
    ImportSiteKind, ImportSpecifier, find_sites_by_name, find_statement_sites,
};
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{ancestors, inside};
use bun_sema::session::{Arena, Session};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use bun_sema_driver::host::{from_argument, from_native, to_native};
use bun_sema_parser::{CompileParseOptions, parse_for_compile, parse_for_compile_in};
use bun_sys::Fd;

use super::texts::{inputs_of_file_that_nobody_describes, without_extension};
use super::{RunInput, WhoseFile};
use crate::ir::parallel::{InParallel, map_each};
use crate::load::contents::load_names::resolve_loads_through_imported_loaders;
use crate::load::sources::parsed_source;
use crate::load::{is_in_node_modules, read_file_bytes};
use crate::options::INDEX_FILES;
use crate::test_run_report::{CodeOutsideRun, say_code_outside_run};

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
    /// A way is a file, under the path that the build gives it. A text that is the path of a compiled file is taken as
    /// it stands. Any other is kept as it stands too, and beside it the file that a `require` of its path finds. A
    /// manifest that names nothing names the index files that `bun compile` takes for the entry point.
    fn read(&mut self, folder: &[u8], text: &[u8], input: &RunInput<'_, '_>) {
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
        ways.retain(|way| !way.is_empty());
        if ways.is_empty() {
            let names = INDEX_FILES.iter();
            (self.ways_into_project).extend(names.map(|name| inside(folder, name)));
        }
        let files = input.files;
        for way in ways {
            let named = from_argument(folder, way);
            let compiled = files.by_path.get(&named);
            if let Some(file) = compiled.filter(|&file| files.is_compiled(file)) {
                let name = files.module(file).file_name();
                let named = if named == name { named } else { name.to_vec() };
                self.ways_into_project.insert(named);
                continue;
            }
            let found = match (named == folder, way.ends_with(b"/")) {
                (true, _) => (input.find_required_file)(folder, b"."),
                (false, true) => {
                    (input.find_required_file)(folder, &[to_native(&named), b"/"].concat())
                }
                (false, false) => (input.find_required_file)(folder, to_native(&named)),
            };
            if let Some(found) = found {
                let found = match files.by_path.get(&found) {
                    Some(file) => files.module(file).file_name().to_vec(),
                    None => found,
                };
                self.ways_into_project.insert(found);
            }
            self.ways_into_project.insert(named);
        }
    }

    fn above_test_files(input: &RunInput<'_, '_>) -> Manifests {
        let options = input.options;
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
                    manifests.read(folder, &text, input);
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
    thread_count: usize,
}

fn list_code_that_run_does_not_reach(disk: &CodeOnDisk<'_>) -> Vec<Vec<u8>> {
    let root = disk.root;
    let mut unread: Vec<Vec<u8>> = Vec::new();
    let mut folders = vec![root.to_vec()];
    while !folders.is_empty() {
        let list_one = |folder: Vec<u8>| {
            let listed = list(to_native(&folder));
            (folder, listed)
        };
        let level = std::mem::take(&mut folders);
        for (folder, listed) in map_each(level, disk.in_parallel, &list_one) {
            folders.extend(listed.folders.iter().map(|name| inside(&folder, name)));
            unread.extend(listed.files.iter().map(|name| inside(&folder, name)));
        }
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

fn list_spellings(file: &[u8]) -> Vec<Vec<u8>> {
    let stem = without_extension(file);
    let mut spellings = vec![file.to_vec(), stem.to_vec()];
    for end in [&b".js"[..], b".jsx", b".mjs", b".cjs"] {
        spellings.push([stem, end].concat());
    }
    spellings.extend(stem.strip_suffix(b"/index").map(<[u8]>::to_vec));
    spellings
}

#[derive(Default)]
struct Written {
    takes_from_test_runner: bool,
    paths: Vec<(Vec<u8>, bool)>,
}

fn is_relative(text: &[u8]) -> bool {
    text.starts_with(b"./") || text.starts_with(b"../") || text == b"." || text == b".."
}

/// An import site of the file may have a specifier that stands in no statement and no string of the file, or may stand in
/// a statement that never runs. Only folding and the scan of the calls find such a site.
fn has_sites_that_need_folding(hir: &File<'_>, atoms: &Interner<'_>) -> bool {
    let names_loader = |name: Atom| name == known::require || name == known::createRequire;
    let key_names_loader = |key: PropKey| key.name().is_some_and(names_loader);
    if !hir.import_equals.is_empty()
        || hir.import_specs.iter().any(|it| names_loader(it.imported))
        || hir.pat_props.iter().any(|it| key_names_loader(it.key))
    {
        return true;
    }
    let mut jumps = false;
    for statement in hir.ids(hir.body) {
        match hir[statement].kind {
            StmtKind::Import(_) | StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. }
                if jumps =>
            {
                return true;
            }
            StmtKind::If { .. }
            | StmtKind::While { .. }
            | StmtKind::DoWhile { .. }
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::Switch { .. }
            | StmtKind::Try { .. }
            | StmtKind::Block(_)
            | StmtKind::Labeled { .. }
            | StmtKind::Throw(_)
            | StmtKind::Return(_) => jumps = true,
            _ => {}
        }
    }
    let is_string = |operand: Option<ExprId>| {
        operand.is_none_or(|it| matches!(hir[it].kind, ExprKind::String(_)))
    };
    hir.exprs.iter().any(|node| match node.kind {
        ExprKind::Ident(name) => names_loader(name),
        ExprKind::String(text) => text.is_some() && is_test_module(atoms.bytes(text)),
        ExprKind::Dot { name, .. } => names_loader(name),
        ExprKind::ImportCall { args } => !is_string(hir.ids(args).next()),
        ExprKind::Call(call) => {
            let callee = hir.skip_type_assertions(hir[call].callee);
            let Some((object, MemberKey::Name(name))) = hir.member_key(callee) else {
                return false;
            };
            let may_load = [
                known::getBuiltinModule,
                known::module,
                known::mock,
                known::doMock,
                known::importActual,
                known::importMock,
                known::requireActual,
                known::requireMock,
                known::createMockFromModule,
            ]
            .contains(&name)
                || names_loader(name)
                || (name == known::resolve
                    && matches!(
                        hir[hir.skip_type_assertions(object)].kind,
                        ExprKind::ImportMeta
                    ));
            may_load && !is_string(hir.ids(hir[call].args).next())
        }
        _ => false,
    })
}

struct SitesOfFile {
    /// The specifier, and whether the site exports what it imports again.
    specifiers: Vec<(Atom, bool)>,
    /// The file evaluates a name that the test runner gives every file, and declares nothing under it.
    has_test_runner_name: bool,
}

impl SitesOfFile {
    fn of_bound_file(
        hir: &File<'_>,
        bound: &Bound<'_>,
        specifiers: Vec<(Atom, bool)>,
        given: &[Atom],
    ) -> SitesOfFile {
        let is_free = |(expression, node): (ExprId, &Expr)| {
            matches!(node.kind, ExprKind::Ident(name) if given.contains(&name))
                && bound.is_evaluated_ident(expression)
                && bound.binding(expression) == Binding::Free
        };
        let mut expressions = (0..).map(ExprId).zip(hir.exprs.iter());
        SitesOfFile {
            specifiers,
            has_test_runner_name: !bound.ran_out_of_stack && expressions.any(is_free),
        }
    }
}

fn bind_options() -> BindOptions {
    BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    }
}

fn exports_again(kind: ImportSiteKind) -> bool {
    matches!(
        kind,
        ImportSiteKind::ExportFrom(_) | ImportSiteKind::ExportStar(_)
    )
}

fn list_specifiers(sites: Vec<(ImportSiteKind, Atom)>) -> Vec<(Atom, bool)> {
    let sites = sites.into_iter();
    sites
        .map(|(kind, specifier)| (specifier, exports_again(kind)))
        .collect()
}

/// Where a string spells a path that is exported again, it depends on the call around the string whether that is a site of
/// its own.
fn spells_exported_path(hir: &File<'_>, specifiers: &[(Atom, bool)]) -> bool {
    let is_exported_again = |text: Atom| {
        let mut exported = specifiers.iter().filter(|it| it.1);
        exported.any(|it| it.0 == text)
    };
    hir.exprs.iter().any(
        |node| matches!(node.kind, ExprKind::String(text) if text.is_some() && is_exported_again(text)),
    )
}

fn find_sites_of_file<'s>(
    hir: &mut File<'s>,
    fold: &FoldInputs<'s>,
    given: &[Atom],
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> SitesOfFile {
    if !has_sites_that_need_folding(hir, atoms)
        && let Some(found) = find_sites_by_name(hir, fold, given)
    {
        let specifiers = list_specifiers(found.sites);
        if !spells_exported_path(hir, &specifiers) {
            return SitesOfFile {
                specifiers,
                has_test_runner_name: found.has_free_name,
            };
        }
    }
    bind_and_find_sites(hir, fold, given, atoms, arena)
}

fn bind_and_find_sites<'s>(
    hir: &mut File<'s>,
    fold: &FoldInputs<'s>,
    given: &[Atom],
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> SitesOfFile {
    if !has_sites_that_need_folding(hir, atoms) {
        let bound = bind_file(hir, bind_options(), fold, atoms, arena);
        if !bound.ran_out_of_stack && !bound.runtime.depends_on_sloppy_mode() {
            let specifiers = list_specifiers(find_statement_sites(hir, &bound, fold));
            if !spells_exported_path(hir, &specifiers) {
                return SitesOfFile::of_bound_file(hir, &bound, specifiers, given);
            }
        }
    }
    find_sites_by_analysis(hir, fold, given, atoms, arena)
}

fn find_sites_by_analysis<'s>(
    hir: &mut File<'s>,
    fold: &FoldInputs<'s>,
    given: &[Atom],
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> SitesOfFile {
    let file = inputs_of_file_that_nobody_describes();
    let (bound, analysis) = analyze_file(hir, bind_options(), fold, file, atoms, arena);
    let sites = analysis.import_sites.iter();
    let specifiers = sites
        .filter_map(|site| match site.specifier {
            ImportSpecifier::Constant(specifier) => Some((specifier, exports_again(site.kind))),
            _ => None,
        })
        .collect();
    SitesOfFile::of_bound_file(hir, &bound, specifiers, given)
}

type FindSites =
    for<'s> fn(&mut File<'s>, &FoldInputs<'s>, &[Atom], &Interner<'s>, &'s Arena) -> SitesOfFile;

fn read_what_file_writes(path: &[u8], text: &[u8], atoms: &Interner<'_>) -> Written {
    read_what_file_writes_by(find_sites_of_file, path, text, atoms)
}

fn read_what_file_writes_by(
    find_sites: FindSites,
    path: &[u8],
    text: &[u8],
    atoms: &Interner<'_>,
) -> Written {
    let session = Session::new();
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
    let mut hir = parse_for_compile_in((arena, &session), &parse_options, text, atoms);
    if matches!(hir.kind, FileKind::Json | FileKind::Declaration) {
        return Written::default();
    }
    hir.text = Cow::Borrowed(text);
    let fold = FoldInputs::new(FoldOptions::default(), arena);
    let given: Vec<Atom> = Jest::GLOBALS
        .iter()
        .map(|name| atoms.intern(name.as_bytes()))
        .collect();
    let SitesOfFile {
        specifiers,
        has_test_runner_name,
    } = find_sites(&mut hir, &fold, &given, atoms, arena);
    let mut written = Written {
        takes_from_test_runner: has_test_runner_name,
        ..Written::default()
    };
    let folder = dirname::<Posix>(path);
    for (specifier, exports_again) in specifiers {
        let specifier = atoms.bytes(specifier);
        written.takes_from_test_runner |= is_test_module(specifier);
        if is_relative(specifier) {
            let path = from_argument(folder, specifier);
            written.paths.push((path, !exports_again));
        }
    }
    let sited: FxHashSet<Vec<u8>> = written.paths.iter().map(|it| it.0.clone()).collect();
    for node in hir.exprs.iter() {
        if let ExprKind::String(text) = node.kind
            && text.is_some()
            && is_relative(atoms.bytes(text))
        {
            let path = from_argument(folder, atoms.bytes(text));
            if !sited.contains(&path) {
                written.paths.push((path, true));
            }
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

struct LastWords<'a> {
    numbers: FxHashMap<&'a [u8], u32>,
    longest: usize,
    /// The words of the files that are asked about have the numbers below this.
    number_asked: u32,
}

/// The words that `text` writes. `None` where one of them is of a file that is asked about: the look ends there.
fn find_last_words_written(text: &[u8], words: &LastWords<'_>) -> Option<WordsWritten> {
    const LONGEST_EXTENSION: usize = 4;
    let mut written: Vec<u32> = Vec::new();
    let mut levels_of_index_files: Vec<u32> = Vec::new();
    let mut climbed: Option<u32> = None;
    for part in strings::split_any(text, b"/\"'`") {
        if let Some(levels) = climbed
            && without_extension(part) == b"index"
        {
            levels_of_index_files.push(levels);
        }
        climbed = match part {
            b"." => Some(climbed.unwrap_or(0)),
            b".." => Some(climbed.unwrap_or(0) + 1),
            b"" => climbed,
            _ => None,
        };
        if let Some(levels) = climbed {
            let end = part.as_ptr() as usize - text.as_ptr() as usize + part.len();
            if text.get(end).is_some_and(|&behind| behind != b'/') {
                levels_of_index_files.push(levels);
            }
        }
        if part.len() > words.longest + LONGEST_EXTENSION {
            continue;
        }
        let shorter = without_extension(part);
        let shorter = (shorter.len() < part.len()).then_some(shorter);
        for spelled in [Some(part), shorter].into_iter().flatten() {
            if let Some(&number) = words.numbers.get(spelled) {
                if number < words.number_asked {
                    return None;
                }
                written.push(number);
            }
        }
    }
    written.sort_unstable();
    written.dedup();
    Some(WordsWritten {
        numbers: written,
        levels_of_index_files,
    })
}

#[derive(Default)]
struct WordsWritten {
    numbers: Vec<u32>,
    levels_of_index_files: Vec<u32>,
}

enum FirstReading {
    Words(WordsWritten),
    WritesWordAskedAbout(Vec<u8>),
}

type ImportersBySpelling = FxHashMap<Vec<u8>, Vec<(usize, bool)>>;

fn note_paths_written(importers: &mut ImportersBySpelling, file: usize, written: Written) {
    for (path, takes_for_itself) in written.paths {
        let importers = importers.entry(path).or_default();
        importers.push((file, takes_for_itself));
    }
}

fn find_importers_outside_run(disk: &CodeOnDisk<'_>, asked: &[Vec<u8>]) -> Vec<Option<Vec<u8>>> {
    let unread = list_code_that_run_does_not_reach(disk);
    let in_memory_files = disk.in_memory_files;
    let mut sought: Vec<Vec<u8>> = asked.to_vec();
    let mut is_imported = vec![false; sought.len()];
    let mut imports: Vec<Vec<(usize, bool)>> = vec![Vec::new(); sought.len()];
    let mut place_in_sought: Vec<Option<usize>> = vec![None; unread.len()];
    let mut words = LastWords {
        numbers: FxHashMap::default(),
        longest: 0,
        number_asked: 0,
    };
    for (place, file) in asked.iter().chain(&unread).enumerate() {
        let (number, word) = (words.numbers.len() as u32, find_last_word(file));
        words.numbers.entry(word).or_insert(number);
        words.longest = words.longest.max(word.len());
        if place < asked.len() {
            words.number_asked = words.numbers.len() as u32;
        }
    }
    let numbers = &words.numbers;
    let read_first = |path: &Vec<u8>| -> FirstReading {
        let Some(text) = read_file(in_memory_files, path) else {
            return FirstReading::Words(WordsWritten::default());
        };
        match find_last_words_written(&text, &words) {
            Some(written) => FirstReading::Words(written),
            None => FirstReading::WritesWordAskedAbout(text),
        }
    };
    let first_readings = map_each(unread.iter().collect(), disk.in_parallel, &read_first);
    let mut writers: Vec<Vec<u32>> = vec![Vec::new(); numbers.len()];
    let mut writers_of_index_files: FxHashMap<Vec<u8>, Vec<u32>> = FxHashMap::default();
    let mut is_parsed = vec![false; unread.len()];
    let mut takes_from_test_runner = vec![false; unread.len()];
    let mut importers_by_spelling: ImportersBySpelling = FxHashMap::default();
    let mut texts_to_parse: Vec<(u32, Vec<u8>)> = Vec::new();
    for (file, reading) in first_readings.into_iter().enumerate() {
        match reading {
            FirstReading::Words(written) => {
                for word in written.numbers {
                    writers[word as usize].push(file as u32);
                }
                for levels in written.levels_of_index_files {
                    let mut folders = ancestors(dirname::<Posix>(&unread[file]));
                    if let Some(folder) = folders.nth(levels as usize) {
                        let writers = writers_of_index_files.entry(inside(folder, b"index"));
                        writers.or_default().push(file as u32);
                    }
                }
            }
            FirstReading::WritesWordAskedAbout(text) => texts_to_parse.push((file as u32, text)),
        }
    }
    let mut counts = CodeOutsideRun {
        files: unread.len(),
        parsed_at_first: texts_to_parse.len(),
        ..CodeOutsideRun::default()
    };
    texts_to_parse.shared_sort_unstable_by_key(|(file, text)| (Reverse(text.len()), *file));
    let sessions_of_atoms: Vec<Session> = (0..disk.thread_count).map(|_| Session::new()).collect();
    let atoms = InternerPerThread::new_in(&sessions_of_atoms);
    let parse_text = |(file, text): (u32, Vec<u8>)| {
        let written = read_what_file_writes(&unread[file as usize], &text, atoms.own());
        (file, written)
    };
    let mut parsed_at_first = map_each(texts_to_parse, disk.in_parallel, &parse_text);
    parsed_at_first.shared_sort_unstable_by_key(|(file, _)| *file);
    for (file, written) in parsed_at_first {
        is_parsed[file as usize] = true;
        takes_from_test_runner[file as usize] = written.takes_from_test_runner;
        note_paths_written(&mut importers_by_spelling, file as usize, written);
    }
    let mut first_unread = 0;
    while first_unread < sought.len() && !unread.is_empty() {
        let round = first_unread..sought.len();
        first_unread = sought.len();
        let mut to_parse: Vec<u32> = Vec::new();
        for file in &sought[round.clone()] {
            if let Some(&number) = numbers.get(find_last_word(file)) {
                to_parse.append(&mut writers[number as usize]);
            }
            if let Some(mut writers) = writers_of_index_files.remove(without_extension(file)) {
                to_parse.append(&mut writers);
            }
        }
        to_parse.sort_unstable();
        to_parse.retain(|&file| !replace(&mut is_parsed[file as usize], true));
        counts.parsed_later += to_parse.len();
        let parse = |file: u32| -> Option<Written> {
            let path = &unread[file as usize];
            let text = read_file(in_memory_files, path)?;
            Some(read_what_file_writes(path, &text, atoms.own()))
        };
        let parsed = map_each(to_parse.clone(), disk.in_parallel, &parse);
        for (file, written) in to_parse.into_iter().zip(parsed) {
            if let Some(written) = written {
                takes_from_test_runner[file as usize] = written.takes_from_test_runner;
                note_paths_written(&mut importers_by_spelling, file as usize, written);
            }
        }
        let mut found: Vec<(usize, usize, bool)> = Vec::new();
        for place in round {
            for spelling in list_spellings(&sought[place]) {
                let importers = importers_by_spelling.get(&spelling);
                let importers = importers.map_or(&[][..], Vec::as_slice).iter();
                found.extend(importers.map(|&(importer, takes)| (importer, place, takes)));
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
            if takes_from_test_runner[importer] {
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
    let is_importer = |file: &usize| place_in_sought[*file].is_some();
    counts.import_what_is_sought = (0..unread.len()).filter(is_importer).count();
    counts.take_from_test_runner = takes_from_test_runner.iter().filter(|it| **it).count();
    say_code_outside_run(asked.len(), &counts);
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
pub(crate) fn find_importers_on_disk(
    root: &[u8],
    files: &[Vec<u8>],
    is_compiled: &(dyn Fn(&[u8]) -> bool + Sync),
) -> Vec<Option<Vec<u8>>> {
    let no_ways = FxHashSet::default();
    let disk = CodeOnDisk {
        root: &from_native(root),
        ways_into_project: &no_ways,
        in_memory_files: &[],
        is_compiled: &|path| is_compiled(to_native(path)),
        in_parallel: &crate::ir::parallel::run_serially,
        thread_count: 1,
    };
    let asked: Vec<Vec<u8>> = files.iter().map(|file| from_native(file)).collect();
    let importers = find_importers_outside_run(&disk, &asked).into_iter();
    importers
        .map(|importer| Some(to_native(&importer?).to_vec()))
        .collect()
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
        manifests: Manifests::above_test_files(input),
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
            thread_count: options.thread_count().get(),
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
    let mut rejects_uncompiled_code = vec![false; count];
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
        rejects_uncompiled_code[index] = !is_of_tests[index] && !loads_for_tests_alone;
    }
    let count_of = |side: WhoseFile| compiled().filter(|file| whose[file.idx()] == side).count();
    crate::test_run_report::say_whose_files(
        count_of(WhoseFile::OfTests),
        behind_helpers,
        count_of(WhoseFile::OfProduct),
        count_of(WhoseFile::OfNeither),
    );
    (whose, rejects_uncompiled_code)
}

#[cfg(test)]
mod tests {
    use super::{
        CodeOnDisk, FindSites, LastWords, find_importers_outside_run, find_last_words_written,
        find_sites_by_analysis, find_sites_of_file, list_spellings, read_what_file_writes,
        read_what_file_writes_by, without_extension,
    };
    use crate::ir::parallel::run_serially;
    use bun_sema::atom::Interner;
    use bun_sema::session::Session;
    use bun_sema::util::{FxHashMap, FxHashSet};

    #[test]
    fn importers_outside_the_run_do_not_hang_on_the_sizes_of_the_files() {
        let filler = "export const filler = [1, 2, 3].map(item => item + 1);\n".repeat(2000);
        let texts = [
            (
                "/made-up/other/one.test.ts",
                "import { test } from \"bun:test\";\nimport { utils } from \"../support/utils\";\ntest(\"one\", () => { utils(1); });\n".to_string(),
            ),
            ("/made-up/other/word-alone.ts", "export const name = \"fixtures\";\n".to_string()),
            (
                "/made-up/tools/uses-taken.ts",
                "import { taken } from \"../support/taken\";\nexport const used = taken(1);\n".to_string(),
            ),
            ("/made-up/zz/hands-on.ts", "export * from \"../support/shapes\";\n".to_string()),
            (
                "/made-up/zz/long.ts",
                format!("{filler}export const here = require(\"../support/clock\");\n"),
            ),
            (
                "/made-up/zz/takes-what-is-handed-on.ts",
                "import { shapes } from \"./hands-on\";\nexport const seen = shapes;\n".to_string(),
            ),
        ];
        let in_memory_files: Vec<(Vec<u8>, Vec<u8>)> = texts
            .into_iter()
            .map(|(path, text)| (path.as_bytes().to_vec(), text.into_bytes()))
            .collect();
        let no_ways = FxHashSet::default();
        let disk = CodeOnDisk {
            root: b"/made-up",
            in_memory_files: &in_memory_files,
            is_compiled: &|_| false,
            ways_into_project: &no_ways,
            in_parallel: &run_serially,
            thread_count: 1,
        };
        let asked: Vec<Vec<u8>> = ["clock", "fixtures", "shapes", "taken", "utils"]
            .iter()
            .map(|name| format!("/made-up/support/{name}.ts").into_bytes())
            .collect();
        let importers = find_importers_outside_run(&disk, &asked);
        let importers: Vec<Option<&str>> = importers
            .iter()
            .map(|it| it.as_deref().map(|path| std::str::from_utf8(path).unwrap()))
            .collect();
        assert_eq!(
            importers,
            [
                Some("/made-up/zz/long.ts"),
                None,
                Some("/made-up/zz/takes-what-is-handed-on.ts"),
                Some("/made-up/tools/uses-taken.ts"),
                None,
            ]
        );
    }

    #[test]
    fn what_a_file_writes_does_not_hang_on_the_files_read_before_it() {
        let texts = [
            "import { test } from \"bun:test\";\nimport \"./first\";\ntest(\"one\", () => {});\n",
            "import \"./second\";\nexport function outer(test: (name: string) => void) { test(\"two\"); }\n",
            "test(\"three\", () => {});\nrequire(\"./third\");\n",
            "const test = 1;\nexport { test };\nexport * from \"./fourth\";\n",
            "const start = \"./fi\";\nexport const fifth = require(start + \"fth\");\n",
            "export const name = \"../up/sixth\";\n",
            "describe.each([1])(\"seven\", () => {});\n",
            "import { vi } from \"vitest\";\nexport const eighth = vi;\n",
            "let expect;\nexpect = 1;\nexport const ninth = () => import(\"./ninth\");\n",
            "export const of = 4, await_ = 2, describe = of / await_;\n",
            "export const bun = \"bun:test\", first = \"./first\";\n",
            "export function it() { return expect; }\n",
        ];
        let read = |text: &str, atoms: &Interner<'_>| {
            let written = read_what_file_writes(b"/made-up/other/file.ts", text.as_bytes(), atoms);
            (written.takes_from_test_runner, written.paths)
        };
        let alone = texts.map(|text| {
            let session = Session::new();
            read(text, &Interner::new_in(&session))
        });
        assert_eq!(
            alone.each_ref().map(|it| it.0),
            [
                true, false, true, false, false, false, true, true, false, false, false, true
            ]
        );
        for is_backward in [false, true] {
            let session = Session::new();
            let atoms = Interner::new_in(&session);
            let mut order: Vec<usize> = (0..texts.len()).collect();
            if is_backward {
                order.reverse();
            }
            for at in order.iter().chain(&order) {
                assert_eq!(read(texts[*at], &atoms), alone[*at], "{}", texts[*at]);
            }
        }
    }

    #[test]
    fn what_a_file_writes_is_what_its_analysis_finds() {
        let texts = [
            "import { test } from \"bun:test\"; import { a } from \"./a\"; test(a);",
            "import { test } from \"bun:test\"; let one: typeof test;",
            "import type { test } from \"vitest\"; import { type A, B } from \"./a\"; let one: A | B;",
            "import { A } from \"./a\"; import { b } from \"./b\"; let one: A = b;",
            "import \"./a\"; import {} from \"./b\"; import * as c from \"./c\"; let one: typeof c;",
            "import D from \"./d\"; class E extends D {} export { E };",
            "import D from \"./d\"; interface E extends D {} export type { E };",
            "import { a } from \"./a\"; export { a };",
            "import { a } from \"./a\"; { const a = 1; use(a); }",
            "export * from \"./a\"; export { b } from \"./b\"; export type { c } from \"./c\"; export * as d from \"./d\";",
            "export * from \"./a\"; const one = import(\"./a\");",
            "export * from \"./a\"; const one = \"./a\";",
            "const start = \"./fi\"; const one = import(start + \"fth\");",
            "const start = \"./fi\"; const one = require(start + \"fth\");",
            "const load = require; load(`./${\"a\"}`); load(\"./b\");",
            "import { createRequire as make } from \"module\"; const load = make(import.meta.url); load(\"./a\" + \"b\");",
            "import * as it from \"module\"; it.createRequire(import.meta.url)(\"./a\" + \"b\");",
            "import.meta.resolve(\"./a\" + \"b\"); Promise.resolve(\"./c\" + \"d\");",
            "import { vi } from \"vitest\"; vi.mock(\"./a\" + \"b\"); vi.mock(\"./c\", () => ({}));",
            "import { vi } from \"vitest\"; vi.mock(import(\"./a\")); const b = vi.importActual(\"./b\");",
            "jest.requireActual(\"./a\" + 1); mock.module(`./b`, () => ({}));",
            "const one = import(\"vitest\");",
            "const one = process.getBuiltinModule(\"bun:\" + \"test\");",
            "import one = require(\"./a\"); import two = one.b; use(two);",
            "throw 1; import \"./a\"; export * from \"./b\";",
            "if (false) { import(\"./a\"); require(\"./b\"); } import \"./c\";",
            "{ function test() {} } test(\"one\");",
            "test(\"one\"); function outer() { with (one) { describe(); } }",
            "const { require: load } = import.meta; load(\"./a\" + \"b\");",
            "arguments[0] = eval(\"test\"); it(\"one\");",
            "let expect: typeof import(\"./a\"); expect = 1; export const b = expect;",
            "import { A } from \"./a\"; interface B extends A {} export const b = {} as B;",
            "import { A } from \"./a\"; class B implements A {} new B();",
            "import { A } from \"./a\"; let x: typeof A; x = 1;",
            "import { a } from \"./a\"; let x: typeof a.b; x = a;",
            "import { a } from \"./a\"; export { a };",
            "import { a } from \"./a\"; export { a as b, c };",
            "import { a } from \"./a\"; export type { a };",
            "import { a } from \"./a\"; export { type a };",
            "import { a } from \"./a\"; export default a;",
            "import { a } from \"./a\"; export = a;",
            "import { a } from \"./a\"; function f(a: number) { return a; } f(1);",
            "import { a } from \"./a\"; function a() {} a();",
            "import type { a } from \"./a\"; a();",
            "import type a from \"./a\"; export const b: a = 1;",
            "import { type a, b } from \"./a\"; a(); let c: b;",
            "import { type it, b } from \"./a\"; it(\"one\"); b();",
            "import { describe } from \"./a\"; describe();",
            "import a, { type b } from \"./a\"; const c: b = 1; it(c);",
            "import a, * as b from \"./a\"; let c: b.C;",
            "import * as a from \"./a\"; let b: a.C; enum E { X = a.d }",
            "import { a } from \"./a\"; const b = { a };",
            "import { a } from \"./a\"; const { a: c } = { a: 1 }; export const d: a = c;",
            "import { a } from \"./a\"; type T = { [a]: 1 };",
            "import { a } from \"./a\"; class C { [a] = 1 }",
            "import { a } from \"./a\"; declare const b: typeof a; declare function f(c?: any): void;",
            "import { a } from \"./a\"; abstract class C { abstract m(x: typeof a): void; m2(x = a) {} }",
            "import { a } from \"./a\"; declare module \"./b\" { const c: typeof a; }",
            "import { a } from \"./a\"; namespace N { export const b = a; }",
            "import { a } from \"./a\"; declare class C { m(b: typeof a): void; }",
            "import { test } from \"./a\"; label: for (;;) { break label; }",
            "import \"./a\"; export * as b from \"./c\"; test(\"x\");",
            "import { a } from \"./a\"; a++; import { b } from \"./b\"; b.c = 1;",
            "import { a } from \"./a\"; import { a as b } from \"./b\"; b(); a satisfies unknown;",
            "import { a } from \"./a\"; a<string>(1); (a as any)(); a!;",
            "import { a } from \"./a\"; eval(\"a\");",
            "import { a } from \"./a\"; let { b = a } = c; [d = a] = e;",
            "import { a } from \"./a\"; for (const b of a) {}",
            "import { a } from \"./a\"; new a.B();",
            "import { a } from \"./a\"; a`x`;",
            "import { a } from \"./a\"; class C extends a {}",
            "import { a } from \"./a\"; class C extends b<a> {}",
            "import { a } from \"./a\"; @a class C {}",
            "import { a } from \"./a\"; const f = async (b: a): Promise<a> => { await b; };",
            "import { a } from \"./a\"; const f = (b) => b?.a;",
            "import { a } from \"./a\"; try {} catch (a) { a; }",
            "import { a } from \"./a\"; return; a();",
            "import { a } from \"./a\"; function f() { return; a(); }",
            "import { it } from \"vitest\"; it(\"x\");",
            "import { it } from \"vitest\"; let x: typeof it;",
            "export {}; it(\"x\");",
            "export {}; let x: typeof it;",
            "export {}; type it = 1; it(\"x\");",
            "export {}; interface it {} it();",
            "export {}; export { it };",
            "export {}; const x = { it }; const { test: y } = x;",
            "export {}; function f(it: any) { it(\"x\"); } test.each;",
            "import it from \"./a\"; it();",
            "import * as it from \"./a\"; let x: it.B; it;",
            "import { a, b } from \"./a\"; import { c } from \"./c\"; a(); const d: c = 1;",
            "import {} from \"./a\"; import { } from \"./b\"; it;",
            "import { a } from \"./a\"; <a>b; let c = b as a;",
            "import { a } from \"./a\"; const b = <a />; const c = <a.d></a.d>;",
            "import { a } from \"./a\"; const b = <div>{a}</div>;",
            "import { A } from \"./a\"; const b = <A></A>;",
            "import { a } from \"./a\"; import a2 = a.b; a2();",
            "import { a } from \"./a\"; a: while (true) break a;",
            "import { a } from \"./a\"; const b = { a() {}, get a() { return 1; }, \"a\": 1 }; b.a;",
            "import { a } from \"./a\"; type T<a> = a; let x: T<1>;",
            "import { a } from \"./a\"; function f<a>(x: a) { return x; }",
            "import { a } from \"./a\"; let x: (a: number) => void;",
            "import { a } from \"./a\"; let x: { a: 1; b(a: 2): a };",
            "import { a } from \"./a\"; function f(this: a) {} f;",
            "import { a } from \"./a\"; function f(x): x is a { return true; } f(1);",
            "import { a } from \"./a\"; enum E { a, b = a }",
            "import { a } from \"./a\"; const { [a]: b } = c;",
            "import { a } from \"./a\"; var x = function a() { a; };",
            "import { a } from \"./a\"; var x = class a { m() { a; } };",
            "import { a } from \"./a\"; { let a = 1; a; }",
            "import { a } from \"./a\"; export class B { private a = 1; m() { return this.a; } }",
            "import { a } from \"./a\"; export class B { constructor(private a: number) {} }",
            "import { a } from \"./a\"; let x: import(\"./b\").a; let y: typeof import(\"./c\");",
            "import { a } from \"./a\" with { type: \"json\" }; export const b = a;",
        ];
        for text in texts {
            for path in [
                &b"/made-up/other/file.ts"[..],
                b"/made-up/other/file.tsx",
                b"/made-up/other/file.js",
            ] {
                let [short, full] =
                    [find_sites_of_file as FindSites, find_sites_by_analysis].map(|find_sites| {
                        let session = Session::new();
                        let atoms = Interner::new_in(&session);
                        let mut written =
                            read_what_file_writes_by(find_sites, path, text.as_bytes(), &atoms);
                        written.paths.sort();
                        written.paths.dedup();
                        (written.takes_from_test_runner, written.paths)
                    });
                assert_eq!(short, full, "{text} {}", path.escape_ascii());
            }
        }
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

    #[test]
    fn spellings_are_the_paths_that_spell_the_file() {
        let stems = [&b"/a/b"[..], b"/a/b/index", b"/a/c", b"/a/b.d"];
        let ends = [
            &b""[..],
            b".ts",
            b".tsx",
            b".js",
            b".jsx",
            b".mjs",
            b".cjs",
            b".json",
        ];
        let paths = stems
            .iter()
            .flat_map(|stem| ends.map(|end| [*stem, end].concat()));
        let paths: Vec<Vec<u8>> = paths.collect();
        for file in &paths {
            let spellings = list_spellings(file);
            for written in &paths {
                let is_listed = spellings.contains(written);
                assert_eq!(is_listed, spells(written, file), "{written:?} {file:?}");
            }
        }
    }

    #[test]
    fn a_text_writes_the_last_words_of_the_paths_in_it() {
        let mut numbers: FxHashMap<&[u8], u32> = FxHashMap::default();
        for (number, word) in (0..).zip([&b"one"[..], b"two", b"three"]) {
            numbers.insert(word, number);
        }
        let text = b"import \"./deep/one.js\"; require('../two'); `three.txt`; 'threethree.js'";
        let mut words = LastWords {
            numbers,
            longest: 5,
            number_asked: 0,
        };
        let find = |words: &LastWords<'_>| Some(find_last_words_written(text, words)?.numbers);
        assert_eq!(find(&words), Some(vec![0, 1]));
        words.number_asked = 1;
        assert_eq!(find(&words), None);
        words.numbers.insert(b"threethree", 3);
        words.number_asked = 0;
        assert_eq!(find(&words), Some(vec![0, 1]));
        words.longest = 10;
        assert_eq!(find(&words), Some(vec![0, 1, 3]));
    }

    #[test]
    fn a_text_says_how_far_above_it_the_index_files_lie_that_it_names_without_their_folder() {
        let words = LastWords {
            numbers: FxHashMap::default(),
            longest: 0,
            number_asked: 0,
        };
        for (text, levels) in [
            (&b"import \"./index\";"[..], &[0][..]),
            (b"require('../index.js')", &[1]),
            (b"import(`../../index.mjs`)", &[2]),
            (b"import \"./index\"; import \"../index.ts\";", &[0, 1]),
            (b"import \"..\";", &[1]),
            (b"require('.')", &[0]),
            (b"import(`../`)", &[1]),
            (b"import \"./\";", &[0]),
            (b"import \"../..\";", &[2]),
            (b"import \"../lib\"; import \"./lib/\"; [...list]", &[]),
            (b"import \"../lib/index\";", &[]),
            (b"import \"index\"; list.index; \"./indexes\"", &[]),
        ] {
            let written = find_last_words_written(text, &words).unwrap();
            assert_eq!(
                written.levels_of_index_files,
                levels,
                "{}",
                text.escape_ascii()
            );
        }
    }

    #[test]
    fn an_extension_is_one_of_eight() {
        for (path, stem) in [
            (&b"a.ts"[..], &b"a"[..]),
            (b"a.tsx", b"a"),
            (b"a.mjs", b"a"),
            (b"a.cts", b"a"),
            (b".js", b""),
            (b"a.json", b"a.json"),
            (b"a.d", b"a.d"),
            (b"ts", b"ts"),
            (b"", b""),
            (b"a.test.js", b"a.test"),
        ] {
            assert_eq!(without_extension(path), stem, "{path:?}");
        }
    }
}
