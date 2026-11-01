//! Who else imports a file of the project. A test run sees what its test files reach. `main.ts`, which no test imports, is on disk all the same, and what it imports is the product's.

use std::borrow::Cow;

use bun_paths::resolve_path::{basename, dirname, platform};
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, RuntimeBindOptions};
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::{FoldInputs, FoldOptions};
use bun_sema::hir::{ExprKind, FileKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier, JsxMode};
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::session::Session;
use bun_sema::util::{FxHashSet, SharedSort};
use bun_sema_parser::{CompileParseOptions, parse_for_compile};
use bun_sys::{Fd, File};

const EXTENSIONS: [&[u8]; 8] = [
    b".ts", b".tsx", b".js", b".jsx", b".mts", b".mjs", b".cts", b".cjs",
];
/// `TEST_NAME_SUFFIXES` of the runner's scanner.
const TEST_NAME_SUFFIXES: [&[u8]; 4] = [b".test", b"_test", b".spec", b"_spec"];

fn without_extension(path: &[u8]) -> &[u8] {
    let ends = EXTENSIONS.iter().find_map(|it| path.strip_suffix(*it));
    ends.unwrap_or(path)
}

fn is_named_as_test_file(name: &[u8]) -> bool {
    let stem = without_extension(name);
    stem.len() < name.len() && TEST_NAME_SUFFIXES.iter().any(|it| stem.ends_with(it))
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
    found.files.shared_sort_unstable();
    found.folders.shared_sort_unstable();
    found
}

fn join(folder: &[u8], relative: &[u8]) -> Vec<u8> {
    let mut path = folder.to_vec();
    for part in bun_core::strings::split(relative, b"/") {
        match part {
            b"" | b"." => {}
            b".." => path.truncate(dirname::<platform::Posix>(&path).len()),
            _ => {
                path.push(b'/');
                path.extend_from_slice(part);
            }
        }
    }
    path
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
    let file = FileInputs {
        declared_module_type: DeclaredModuleType::Unknown,
        import_meta_main: None,
        is_library: false,
        host_values: &[],
        jsx: JsxMode::Classic,
        own_name: arena.alloc_slice_copy(basename(path)),
    };
    let (_, analysis) = analyze_file(&mut hir, bind_options, &fold, file, &atoms, arena);
    let mut written = Written::default();
    let folder = dirname::<platform::Posix>(path);
    let is_relative = |text: &[u8]| {
        text.starts_with(b"./") || text.starts_with(b"../") || text == b"." || text == b".."
    };
    for site in analysis.import_sites {
        let ImportSpecifier::Constant(specifier) = site.specifier else {
            continue;
        };
        let specifier = atoms.bytes(specifier);
        written.takes_from_test_runner |=
            matches!(specifier, b"bun:test" | b"@jest/globals" | b"vitest");
        if is_relative(specifier) {
            let exports_again = matches!(
                site.kind,
                ImportSiteKind::ExportFrom(_) | ImportSiteKind::ExportStar(_)
            );
            written
                .paths
                .push((join(folder, specifier), !exports_again));
        }
    }
    // `createRequire(import.meta.url)("./src/loads.cjs")`, `new URL("./worker.ts", import.meta.url)`.
    let sited: FxHashSet<Vec<u8>> = written.paths.iter().map(|it| it.0.clone()).collect();
    for expression in hir.exprs.iter() {
        if let ExprKind::String(text) = expression.kind
            && is_relative(atoms.bytes(text))
        {
            let path = join(folder, atoms.bytes(text));
            if !sited.contains(&path) {
                written.paths.push((path, true));
            }
        }
    }
    written
}

pub struct ImporterOnDisk {
    pub imported: Vec<u8>,
    pub importer: Vec<u8>,
}

/// For each of `files`, the first file below `root` that takes it for itself and is not of the tests. node_modules and folders whose names begin with a dot are left out.
/// Of the tests: what `is_of_tests` says, a file that the runner would take for a test file, what lies in the folder of one or below it, and what takes something from the test runner.
/// A file that only exports one of `files` again stands for whoever imports that file.
/// `passes_over`: the files that the caller has read itself.
pub fn find_importers_on_disk(
    root: &[u8],
    files: &[Vec<u8>],
    is_of_tests: &dyn Fn(&[u8]) -> bool,
    passes_over: &dyn Fn(&[u8]) -> bool,
) -> Vec<ImporterOnDisk> {
    let mut found: Vec<ImporterOnDisk> = Vec::new();
    // What stands for what: a file that exports `files[n]` again is sought for it.
    let mut sought: Vec<(Vec<u8>, usize)> = files.iter().cloned().zip(0..).collect();
    let mut first_unread = 0;
    while first_unread < sought.len() {
        let round: Vec<(Vec<u8>, usize)> = sought[first_unread..].to_vec();
        first_unread = sought.len();
        let is_settled =
            |found: &[ImporterOnDisk], of: usize| found.iter().any(|it| it.imported == files[of]);
        let mut folders = vec![root.to_vec()];
        while let Some(folder) = folders.pop() {
            if round.iter().all(|it| is_settled(&found, it.1)) {
                break;
            }
            let listed = list(&folder);
            if listed.files.iter().any(|it| is_named_as_test_file(it)) {
                continue;
            }
            folders.extend(
                listed
                    .folders
                    .iter()
                    .rev()
                    .map(|it| [&folder[..], b"/", it].concat()),
            );
            for name in &listed.files {
                let path = [&folder[..], b"/", name].concat();
                if without_extension(name).len() == name.len()
                    || passes_over(&path)
                    || is_of_tests(&path)
                {
                    continue;
                }
                let Ok(text) = File::read_from(Fd::cwd(), &path) else {
                    continue;
                };
                let may_write = |file: &[u8]| {
                    let stem = without_extension(basename(file));
                    let stem = match stem {
                        b"index" => basename(dirname::<platform::Posix>(file)),
                        _ => stem,
                    };
                    bun_core::strings::index_of(&text, stem).is_some()
                };
                if !round
                    .iter()
                    .any(|it| !is_settled(&found, it.1) && may_write(&it.0))
                {
                    continue;
                }
                let written = read_what_file_writes(&path, &text);
                if written.takes_from_test_runner {
                    continue;
                }
                for (file, of) in &round {
                    if *file == path || is_settled(&found, *of) {
                        continue;
                    }
                    let mut ways = written
                        .paths
                        .iter()
                        .filter(|it| spells(&it.0, file))
                        .peekable();
                    if ways.peek().is_none() {
                        continue;
                    }
                    if ways.any(|it| it.1) {
                        found.push(ImporterOnDisk {
                            imported: files[*of].clone(),
                            importer: path.clone(),
                        });
                    } else if !sought.iter().any(|it| it.0 == path && it.1 == *of) {
                        sought.push((path.clone(), *of));
                    }
                }
            }
        }
    }
    found
}

/// For the list at the end of a run: why `file`, which asked for code that was not compiled, is the product's.
pub fn find_importer_outside_tests(root: &[u8], file: &[u8]) -> Option<Vec<u8>> {
    let found = find_importers_on_disk(root, &[file.to_vec()], &|_| false, &|_| false);
    found.into_iter().next().map(|it| it.importer)
}
