use bun_io::Write as _;

use crate::cli::Command;
use crate::cli::run_compiled;
use crate::cli::test::changed_files_filter as ChangedFilesFilter;
use crate::cli::test::parallel_runner as ParallelRunner;
use crate::cli::test::scanner::{self, Scanner};
use crate::cli::test::timings::Timings;
use bun_collections::BoundedArray;
use bun_core::{self as bun, Global, Output, env_var, fmt as bun_fmt};
use bun_core::{EncodedSlice, strings};
use bun_core::{pretty_error, pretty_errorln};
use bun_dotenv as DotEnv;
use bun_jsc::event_loop::TopLevelWaitError;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc};
use bun_options_types::aot_options::ReplacedByTests;
use bun_options_types::code_coverage_options::CodeCoverageOptions;
use bun_options_types::context::{JunitSuites, ReactCompilerScope, TestEnvironment, TestGlobals};
use bun_paths as bun_path;
use bun_paths::resolve_path;
use bun_paths::string_paths::without_leading_path_separator;
use bun_ptr::Interned;
use bun_resolver::fs::FileSystem;
use bun_sys::{self, Fd, File};

// Debug log scope for test-runner entrypoint loading.
bun_output::declare_scope!(bun_test, hidden);

mod coverage {
    pub(super) use bun_sourcemap_jsc::code_coverage::{
        ByteRangeMapping, Fraction, Report as CodeCoverageReport, lcov, text,
    };

    /// Less-than predicate adapted to the `Ordering` shape `sort_by` wants.
    #[inline]
    pub(super) fn is_less_than_cmp(
        a: &&mut ByteRangeMapping,
        b: &&mut ByteRangeMapping,
    ) -> core::cmp::Ordering {
        bun_core::order(a.source_url.slice(), b.source_url.slice())
    }

    pub(super) fn is_ignored(
        ignore_patterns: &[bun_glob::Prepared<&[u8]>],
        relative_dir: &[u8],
        source_url: &[u8],
    ) -> bool {
        if ignore_patterns.is_empty() {
            return false;
        }
        let relative_path = bun_paths::resolve_path::relative(relative_dir, source_url);
        ignore_patterns
            .iter()
            .any(|pattern| pattern.r#match(relative_path).matches())
    }
}
use coverage::{ByteRangeMapping, CodeCoverageReport, Fraction};

fn end_of_string(text: &[u8], mut at: usize, quote: u8) -> usize {
    while at < text.len()
        && let Some(found) = strings::index_of_any(&text[at..], &[quote, b'\\', b'\n'])
    {
        at += found;
        match text[at] {
            b'\\' => at += 2,
            _ => return at + 1,
        }
    }
    text.len()
}

fn end_of_template_part(text: &[u8], mut at: usize, open_braces: &mut Vec<u32>) -> usize {
    while at < text.len()
        && let Some(found) = strings::index_of_any(&text[at..], b"`\\$")
    {
        at += found;
        match text[at] {
            b'\\' => at += 2,
            b'`' => return at + 1,
            _ if text.get(at + 1) == Some(&b'{') => {
                open_braces.push(0);
                return at + 2;
            }
            _ => at += 1,
        }
    }
    text.len()
}

fn end_of_regular_expression(text: &[u8], mut at: usize) -> usize {
    let mut is_in_class = false;
    while at < text.len() {
        match text[at] {
            b'\\' => at += 1,
            b'[' => is_in_class = true,
            b']' => is_in_class = false,
            b'/' if !is_in_class => return at + 1,
            b'\n' => return at,
            _ => {}
        }
        at += 1;
    }
    text.len()
}

fn begins_regular_expression(before_slash: &[u8]) -> bool {
    const WORDS: [&[u8]; 14] = [
        b"return",
        b"typeof",
        b"case",
        b"do",
        b"else",
        b"in",
        b"of",
        b"void",
        b"delete",
        b"throw",
        b"new",
        b"instanceof",
        b"yield",
        b"await",
    ];
    let before = before_slash.trim_ascii_end();
    let Some(&last) = before.last() else {
        return true;
    };
    if is_identifier_byte(last) {
        let start = before.iter().rposition(|&byte| !is_identifier_byte(byte));
        return WORDS.contains(&&before[start.map_or(0, |at| at + 1)..]);
    }
    !matches!(last, b')' | b']' | b'}' | b'"' | b'\'' | b'`')
}

fn blank_comments(text: &mut [u8]) {
    let mut open_braces: Vec<u32> = Vec::new();
    let mut at = 0;
    while at < text.len()
        && let Some(found) = strings::index_of_any(&text[at..], b"\"'`/{}")
    {
        at += found;
        match text[at] {
            quote @ (b'"' | b'\'') => at = end_of_string(text, at + 1, quote),
            b'`' => at = end_of_template_part(text, at + 1, &mut open_braces),
            b'{' => {
                if let Some(open) = open_braces.last_mut() {
                    *open += 1;
                }
                at += 1;
            }
            b'}' => match open_braces.last_mut() {
                Some(0) => {
                    open_braces.pop();
                    at = end_of_template_part(text, at + 1, &mut open_braces);
                }
                Some(open) => {
                    *open -= 1;
                    at += 1;
                }
                None => at += 1,
            },
            _ => match text.get(at + 1) {
                Some(b'/') => {
                    let length = strings::index_of_char_usize(&text[at..], b'\n');
                    let end = length.map_or(text.len(), |length| at + length);
                    text[at..end].fill(b' ');
                    at = end;
                }
                Some(b'*') => {
                    let length = strings::index_of(&text[at + 2..], b"*/");
                    let end = length.map_or(text.len(), |length| at + length + 4);
                    for byte in text[at..end].iter_mut().filter(|byte| **byte != b'\n') {
                        *byte = b' ';
                    }
                    at = end;
                }
                _ if begins_regular_expression(&text[..at]) => {
                    at = end_of_regular_expression(text, at + 1);
                }
                _ => at += 1,
            },
        }
    }
}

fn read_code(path: &[u8]) -> Option<Vec<u8>> {
    let mut text = File::read_from(Fd::cwd(), path).ok()?;
    blank_comments(&mut text);
    Some(text)
}

// The strings behind `from`, `import`, `require` and `module` (of `mock.module`). One too many names a file too many.
fn for_each_imported_name(text: &[u8], mut visit: impl FnMut(&[u8])) {
    for_each_imported_name_and_word(text, |name, _| visit(name));
}

fn for_each_imported_name_and_word(text: &[u8], mut visit: impl FnMut(&[u8], &[u8])) {
    const WORDS: [&[u8]; 4] = [b"from", b"import", b"require", b"module"];
    let mut at = 0;
    while let Some(found) = strings::index_of_any(&text[at..], b"fimr") {
        at += found;
        let Some(word) = WORDS.iter().find(|word| text[at..].starts_with(word)) else {
            at += 1;
            continue;
        };
        let is_of_types = *word == b"from" && ends_declaration_of_types(&text[..at]);
        at += word.len();
        if is_of_types {
            continue;
        }
        let rest = &text[at..];
        let skipped = rest.len() - rest.trim_ascii_start().len();
        let rest = &rest[skipped..];
        let rest = rest
            .strip_prefix(b"(")
            .map_or(rest, <[u8]>::trim_ascii_start);
        let Some((&quote @ (b'"' | b'\'' | b'`'), name)) = rest.split_first() else {
            continue;
        };
        // "the module's .. don't" in a comment. No file system takes a longer part of a path, and the resolver would call it an error.
        const LONGEST_PART_OF_PATH: usize = 255;
        if let Some(end) = strings::index_of_any(name, &[quote, b'\n'])
            && name[end] == quote
            && strings::split(&name[..end], b"/").all(|part| part.len() <= LONGEST_PART_OF_PATH)
            && !is_imported_as_data(&name[end + 1..])
        {
            visit(&name[..end], word);
        }
    }
}

// What stands in front of `from`: `import type A`, `import type { A, B }`, `export type { A }`, `export type *`. Nothing of it is left when the file runs, so it brings no file into a
// program: a package that a project imports for its types alone would be compiled for every test run. `import type from "x"` imports a value under the name `type`.
fn ends_declaration_of_types(before_from: &[u8]) -> bool {
    let starts = [&b"import"[..], b"export"].map(|word| strings::last_index_of(before_from, word));
    let Some(start) = starts.into_iter().flatten().max() else {
        return false;
    };
    let declared = before_from[start + b"import".len()..].trim_ascii();
    let is_one_declaration = !strings::contains_char(declared, b';')
        && strings::index_of_any(declared, b"\"'`(").is_none();
    let Some(names) = declared
        .strip_prefix(b"type")
        .filter(|_| is_one_declaration)
    else {
        return false;
    };
    let begins_names = |byte: &u8| byte.is_ascii_whitespace() || *byte == b'{' || *byte == b'*';
    names.first().is_some_and(begins_names) && !names.trim_ascii_start().starts_with(b",")
}

// What follows the name of an import: ` with { type: "file" }`, `, { with: { type: "text" } })`. The file is a path or bytes to the importer and runs nowhere, so no program holds
// it for this import: a bundle of 3 MB that a program serves to browsers by its path would be compiled for every test run. Only the types of code leave it code.
fn is_imported_as_data(behind_name: &[u8]) -> bool {
    let mut rest = behind_name.trim_ascii_start();
    if let Some(options) = rest.strip_prefix(b",") {
        rest = options.trim_ascii_start();
        let Some(options) = rest.strip_prefix(b"{") else {
            return false;
        };
        rest = options.trim_ascii_start();
    }
    let Some(attributes) = rest.strip_prefix(b"with") else {
        return false;
    };
    let attributes = attributes.trim_ascii_start();
    let attributes = (attributes.strip_prefix(b":")).map_or(attributes, <[u8]>::trim_ascii_start);
    let Some(attributes) = attributes.strip_prefix(b"{") else {
        return false;
    };
    let attributes = attributes.trim_ascii_start();
    let Some(value) = attributes.strip_prefix(b"type") else {
        return false;
    };
    let value = value.trim_ascii_start();
    let Some(value) = value.strip_prefix(b":") else {
        return false;
    };
    let value = value.trim_ascii_start();
    let Some((&quote @ (b'"' | b'\''), value)) = value.split_first() else {
        return false;
    };
    let Some(end) = strings::index_of_char_usize(value, quote) else {
        return false;
    };
    !matches!(
        &value[..end],
        b"js" | b"jsx" | b"ts" | b"tsx" | b"mjs" | b"cjs"
    )
}

// A file with JSX imports the run time of JSX and does not spell its name. The names are what the tsconfig.json of the file makes of them.
fn find_names_imported_for_jsx(vm: &mut VirtualMachine, file: &[u8]) -> Vec<Box<[u8]>> {
    const EXTENSIONS: [&[u8]; 3] = [b".tsx", b".jsx", b".js"];
    if !EXTENSIONS.iter().any(|extension| file.ends_with(extension)) {
        return Vec::new();
    }
    let folder = resolve_path::dirname::<bun_path::platform::Auto>(file);
    let kind = bun_ast::ImportKind::Stmt;
    let Ok(result) = vm.transpiler.resolver.resolve(folder, file, kind) else {
        return Vec::new();
    };
    let source = &result.jsx.import_source;
    vec![
        Box::from(&*source.development),
        Box::from(&*source.production),
    ]
}

fn find_names_imported_by_and_how<Path: core::ops::Deref<Target = [u8]> + Sync>(
    files: &[Path],
) -> Vec<Vec<Box<[u8]>>> {
    find_names_in(files, for_each_imported_name_and_how)
}

fn for_each_imported_name_and_how(text: &[u8], visit: &mut dyn FnMut(&[u8])) {
    let mut marked = Vec::new();
    for_each_imported_name_and_word(text, |name, word| {
        marked.clear();
        marked.push(match word {
            b"from" | b"import" => 1,
            b"require" => 2,
            _ => 0,
        });
        marked.extend_from_slice(name);
        visit(&marked);
    })
}

// `bun test` takes a file whose text does not say what it is for CommonJS or for an ES module by who loads it: `require` goes by the extension, `import` by the package.
// The build of a layer does not see the files above it, so it is told which of its entry points they name behind `import` alone. Only four extensions say something.
// find_files_imported_by() has read the files above and noted what they name in another way.
static FILES_NAMED_OTHERWISE_THAN_BY_IMPORT: bun_threading::Guarded<Vec<Box<[u8]>>> =
    bun_threading::Guarded::new(Vec::new());
static FILES_REQUIRED: bun_threading::Guarded<Vec<Box<[u8]>>> =
    bun_threading::Guarded::new(Vec::new());

fn find_entry_points_only_imported(entry_points: &[Box<[u8]>]) -> Vec<Vec<u8>> {
    const EXTENSIONS: [&[u8]; 4] = [b".cjs", b".cts", b".mjs", b".mts"];
    let named_otherwise = FILES_NAMED_OTHERWISE_THAN_BY_IMPORT.lock();
    (entry_points.iter())
        .filter(|path| EXTENSIONS.iter().any(|extension| path.ends_with(extension)))
        .filter(|path| !named_otherwise.contains(path))
        .map(|path| path.to_vec())
        .collect()
}

fn find_entry_points_required(entry_points: &[Box<[u8]>]) -> Vec<Vec<u8>> {
    let mut required = bun_collections::StringSet::new();
    for path in FILES_REQUIRED.lock().iter() {
        let _ = required.insert(path);
    }
    (entry_points.iter())
        .filter(|path| required.contains(path))
        .map(|path| path.to_vec())
        .collect()
}

fn find_names_in<Path: core::ops::Deref<Target = [u8]> + Sync>(
    files: &[Path],
    for_each_name: fn(&[u8], &mut dyn FnMut(&[u8])),
) -> Vec<Vec<Box<[u8]>>> {
    find_names_and_sizes_in(files, for_each_name).0
}

fn find_names_and_sizes_in<Path: core::ops::Deref<Target = [u8]> + Sync>(
    files: &[Path],
    for_each_name: fn(&[u8], &mut dyn FnMut(&[u8])),
) -> (Vec<Vec<Box<[u8]>>>, Vec<u64>) {
    const MAX_READERS: usize = 64;
    const MIN_FILES_OF_READER: usize = 16;
    let mut names: Vec<Vec<Box<[u8]>>> = Vec::new();
    names.resize_with(files.len(), Vec::new);
    let mut sizes = vec![0; files.len()];
    let share = files.len().div_ceil(MAX_READERS).max(MIN_FILES_OF_READER);
    let shares = (files.chunks(share).zip(names.chunks_mut(share))).zip(sizes.chunks_mut(share));
    run_compiled::for_each_on_threads(shares.collect(), |((files, names), sizes)| {
        for ((file, names), size) in files.iter().zip(names).zip(sizes) {
            if let Some(text) = read_code(file) {
                *size = text.len() as u64;
                for_each_name(&text, &mut |name| names.push(Box::from(name)));
            }
        }
    });
    (names, sizes)
}

fn keep_paths_for_the_build(paths: Vec<Box<[u8]>>) -> Vec<Interned> {
    static KEPT: std::sync::OnceLock<Vec<Box<[u8]>>> = std::sync::OnceLock::new();
    assert!(KEPT.set(paths).is_ok(), "a process builds one part");
    let kept = KEPT.get().expect("set above");
    (kept.iter())
        .map(|path| Interned::from_static(path))
        .collect()
}

// A trial. The files with code that the test files import, each once, in the order found. The test files are not among them.
fn find_files_imported_by<Path: core::ops::Deref<Target = [u8]> + Sync>(
    vm: &mut VirtualMachine,
    test_files: &[Path],
) -> Vec<Box<[u8]>> {
    const EXTENSIONS: [&[u8]; 8] = [
        b".ts", b".tsx", b".js", b".jsx", b".mjs", b".cjs", b".mts", b".cts",
    ];
    let mut seen = bun_collections::StringSet::new();
    for path in test_files {
        let _ = seen.insert(&**path);
    }
    let mut found = Vec::new();
    let mut named_otherwise = Vec::new();
    let mut required = Vec::new();
    for (test_file, names) in test_files
        .iter()
        .zip(find_names_imported_by_and_how(test_files))
    {
        let folder = resolve_path::dirname::<bun_path::platform::Auto>(test_file);
        for marked in names {
            let (is_behind_import, name) = (marked[0] == 1, &marked[1..]);
            let is_behind_require = marked[0] == 2;
            if !is_behind_import {
                let kind = bun_ast::ImportKind::Require;
                if let Ok(result) = vm.transpiler.resolver.resolve(folder, name, kind) {
                    named_otherwise.push(Box::from(result.path_pair.primary.text()));
                    if is_behind_require {
                        required.push(Box::from(result.path_pair.primary.text()));
                    }
                }
            }
            let kind = bun_ast::ImportKind::Stmt;
            let Ok(result) = vm.transpiler.resolver.resolve(folder, name, kind) else {
                continue;
            };
            let path = result.path_pair.primary.text();
            if !is_behind_import {
                named_otherwise.push(Box::from(path));
            }
            if is_behind_require {
                required.push(Box::from(path));
            }
            let is_code = bun_path::is_absolute(path)
                && EXTENSIONS.iter().any(|extension| path.ends_with(extension));
            if is_code && !seen.contains(path) {
                let _ = seen.insert(path);
                found.push(Box::from(path));
            }
        }
    }
    note_how_files_are_named(named_otherwise, required);
    found
}

fn note_how_files_are_named(mut named_otherwise: Vec<Box<[u8]>>, mut required: Vec<Box<[u8]>>) {
    FILES_NAMED_OTHERWISE_THAN_BY_IMPORT
        .lock()
        .append(&mut named_otherwise);
    FILES_REQUIRED.lock().append(&mut required);
}

// The files of packages that the test files reach through files that are in no package. What those import in turn the build finds itself.
// And the files that lead to them, the test files included.
// Whether the files and what they import, packages too, hold more bytes of source than `most`. It stops looking where they do.
fn reach_more_source_than(vm: &mut VirtualMachine, files: Vec<Box<[u8]>>, most: u64) -> bool {
    let mut unread_log = bun_ast::Log::init();
    // SAFETY: the resolver and `unread_log` outlive the guard.
    let _log_scope = unsafe {
        bun_resolver::Resolver::scoped_log(
            &raw mut vm.transpiler.resolver,
            core::ptr::NonNull::from(&mut unread_log),
        )
    };
    let mut seen = bun_collections::StringSet::new();
    let mut bytes = 0;
    let mut level = files;
    while !level.is_empty() {
        for path in &level {
            let _ = seen.insert(path);
            bytes += bun_sys::stat(&bun_core::ZBox::from_bytes(path))
                .map_or(0, |stat| stat.st_size as u64);
        }
        if bytes > most {
            return true;
        }
        level = find_files_imported_by(vm, &level);
        level.retain(|path| !seen.contains(path));
    }
    false
}

fn find_files_of_packages_reached_from(
    vm: &mut VirtualMachine,
    test_files: Vec<Box<[u8]>>,
) -> (Vec<Box<[u8]>>, Vec<Box<[u8]>>) {
    let reached = find_files_reached_from(vm, test_files, &[]);
    (reached.of_packages, reached.others)
}

struct FilesReached {
    of_packages: Vec<Box<[u8]>>,
    others: Vec<Box<[u8]>>,
    by_preloads_alone: Vec<Box<[u8]>>,
}

fn find_files_reached_from(
    vm: &mut VirtualMachine,
    test_files: Vec<Box<[u8]>>,
    preloads: &[Box<[u8]>],
) -> FilesReached {
    let mut seen = bun_collections::StringSet::new();
    let mut of_packages = Vec::new();
    let mut others = Vec::new();
    let mut level = test_files;
    let top = FileSystem::get().top_level_dir();
    for path in &level {
        let _ = seen.insert(resolve_path::join_abs_string::<bun_path::platform::Auto>(
            top,
            &[&path[..]],
        ));
    }
    while !level.is_empty() {
        let mut next = Vec::new();
        for path in find_files_imported_by(vm, &level) {
            if seen.contains(&path) {
                continue;
            }
            let _ = seen.insert(&path);
            match strings::contains(&path, b"/node_modules/") {
                true => of_packages.push(path),
                false => next.push(path),
            }
        }
        others.append(&mut level);
        level = next;
    }
    let mut by_preloads_alone = Vec::new();
    let mut level = preloads.to_vec();
    while !level.is_empty() {
        let mut next = find_files_imported_by(vm, &level);
        next.retain(|path| !strings::contains(path, b"/node_modules/") && !seen.contains(path));
        for path in &next {
            let _ = seen.insert(path);
        }
        by_preloads_alone.extend_from_slice(&next);
        level = next;
    }
    FilesReached {
        of_packages,
        others,
        by_preloads_alone,
    }
}

static FILES_TO_PLAN_LAYERS_FROM: bun_threading::Guarded<Option<Vec<Box<[u8]>>>> =
    bun_threading::Guarded::new(None);

pub(crate) fn plan_programs_of_project(
    vm: &mut VirtualMachine,
    memory_limit: Option<u64>,
) -> Option<u32> {
    let files = FILES_TO_PLAN_LAYERS_FROM.lock().take()?;
    let mut unread_log = bun_ast::Log::init();
    // SAFETY: the resolver and `unread_log` outlive the guard.
    let _log_scope = unsafe {
        bun_resolver::Resolver::scoped_log(
            &raw mut vm.transpiler.resolver,
            core::ptr::NonNull::from(&mut unread_log),
        )
    };
    let given = files.len();
    let found = find_what_stands_behind_computed_imports(vm, files);
    run_compiled::hand_lists_to_builds_of_layers(&[
        &[Box::from(found.import_count.to_string().as_bytes())],
        &found.files,
        &found.of_packages,
    ]);
    if run_compiled::is_number_of_layers_given() {
        return None;
    }
    let of_project = found.files;
    let mut bytes_of_project = 0;
    for path in &of_project[given..] {
        let stat = bun_sys::stat(&bun_core::ZBox::from_bytes(path));
        bytes_of_project += stat.map_or(0, |stat| stat.st_size as u64);
    }
    Some(run_compiled::plan_programs_of_project(
        memory_limit,
        bytes_of_project,
    ))
}

// The modules of Bun's own code that the files, and all that they import, spell, and the built-ins for which native code loads one. None: one of the files
// loads code under a name that its text does not spell, which may be the name of any module.
fn find_library_modules_spelled_from(
    vm: &mut VirtualMachine,
    files: Vec<Box<[u8]>>,
) -> Option<bun_collections::StringSet> {
    // An empty name: none.
    let for_each_module = |text: &[u8], visit: &mut dyn FnMut(&[u8])| {
        match bun_aot::builtins::library_modules_spelled_in(text) {
            Some(modules) => modules.into_iter().for_each(&mut *visit),
            None => return visit(b""),
        }
        let builtins = bun_aot::builtins::builtins_that_load_library_modules_spelled_in(text);
        let builtins =
            builtins.unwrap_or_else(bun_aot::builtins::builtins_that_load_library_modules);
        builtins.iter().for_each(|it| visit(it.as_bytes()));
    };
    let mut seen = bun_collections::StringSet::new();
    let mut spelled = bun_collections::StringSet::new();
    let mut level = files;
    while !level.is_empty() {
        for path in &level {
            let _ = seen.insert(path);
        }
        for name in find_names_in(&level, for_each_module).iter().flatten() {
            if name.is_empty() {
                return None;
            }
            let _ = spelled.insert(name);
        }
        let started = find_files_that_workers_start_from(vm, &level);
        level = find_files_imported_by(vm, &level);
        level.extend(started);
        level.retain(|path| !seen.contains(path));
    }
    Some(spelled)
}

fn find_files_that_workers_start_from(
    vm: &mut VirtualMachine,
    files: &[Box<[u8]>],
) -> Vec<Box<[u8]>> {
    let mut found = Vec::new();
    for (file, names) in files
        .iter()
        .zip(find_names_in(files, for_each_name_that_build_follows))
    {
        let folder = resolve_path::dirname::<bun_path::platform::Auto>(file);
        for marked in names.iter().filter(|marked| marked[0] == BY_WORKER) {
            let kind = bun_ast::ImportKind::Stmt;
            if let Ok(result) = vm.transpiler.resolver.resolve(folder, &marked[1..], kind) {
                found.push(Box::from(result.path_pair.primary.text()));
            }
        }
    }
    found
}

const BY_STATEMENT: u8 = 1;
const BY_IMPORT_CALL: u8 = 2;
const BY_REQUIRE: u8 = 4;
const BY_WORKER: u8 = 8;

fn visit_with_way(visit: &mut dyn FnMut(&[u8]), way: u8, name: &[u8]) {
    visit(&[&[way][..], name].concat());
}

fn for_each_name_that_loads(text: &[u8], visit: &mut dyn FnMut(&[u8])) {
    for_each_name_in_statement(text, |name| visit_with_way(visit, BY_STATEMENT, name));
    let mut at = 0;
    while let Some(found) = strings::index_of_char_usize(&text[at..], b'(') {
        let before = text[..at + found].trim_ascii_end();
        at += found + 1;
        let way = match before {
            _ if before.ends_with(b"import") => BY_IMPORT_CALL,
            _ if before.ends_with(b"require") => BY_REQUIRE,
            _ => continue,
        };
        if let Some((name, _)) = read_string(text, skip_space(text, at), b"\"'`")
            && !strings::contains(name, b"${")
        {
            visit_with_way(visit, way, name);
        }
    }
}

// And what the build of a program follows beside them: `for_each_pattern_that_loads`, and the file that a Worker starts from,
// `new Worker("./a.ts")` or `new Worker(new URL("./a.ts", import.meta.url))`. A URL that goes elsewhere loads nothing.
fn for_each_name_that_build_follows(text: &[u8], visit: &mut dyn FnMut(&[u8])) {
    const URL: &[u8] = b"new URL(";
    for_each_name_that_loads(text, &mut *visit);
    for_each_pattern_that_loads_and_way(text, &mut |pattern, way| {
        visit_with_way(visit, way, pattern)
    });
    let mut at = 0;
    while let Some(found) = strings::index_of(&text[at..], b"Worker(") {
        at += found + b"Worker(".len();
        let mut start = skip_space(text, at);
        if text[start..].starts_with(URL) {
            start = skip_space(text, start + URL.len());
        }
        if let Some((name, _)) = read_string(text, start, b"\"'`")
            && !strings::contains(name, b"${")
        {
            visit_with_way(visit, BY_WORKER, name);
        }
    }
}

// `import(`a/b/${name}.js`)`, and `require()` alike: what stands in front of the first `${`, a zero byte, and what stands behind the last `}`.
fn for_each_pattern_that_loads(text: &[u8], visit: &mut dyn FnMut(&[u8])) {
    for_each_pattern_that_loads_and_way(text, &mut |pattern, _| visit(pattern));
}

fn for_each_pattern_that_loads_and_way(text: &[u8], visit: &mut dyn FnMut(&[u8], u8)) {
    let mut at = 0;
    while let Some(found) = strings::index_of_char_usize(&text[at..], b'(') {
        let before = text[..at + found].trim_ascii_end();
        at += found + 1;
        let way = match before {
            _ if before.ends_with(b"import") => BY_IMPORT_CALL,
            _ if before.ends_with(b"require") => BY_REQUIRE,
            _ => continue,
        };
        let Some((template, _)) = read_string(text, skip_space(text, at), b"`") else {
            continue;
        };
        let first = strings::index_of(template, b"${");
        let last = strings::last_index_of_char(template, b'}');
        if let (Some(first), Some(last)) = (first, last)
            && first < last
        {
            visit(
                &[&template[..first], b"\0", &template[last + 1..]].concat(),
                way,
            );
        }
    }
}

// The folder of the package that `name` names for a file in `folder`.
fn find_folder_of_package(folder: &[u8], name: &[u8]) -> Option<Vec<u8>> {
    let mut ancestor = folder;
    loop {
        let installed = bun_core::ZBox::from_bytes([ancestor, b"/node_modules/", name].concat());
        if bun_sys::directory_exists_at(Fd::cwd(), &installed).unwrap_or(false) {
            let mut real = bun_paths::path_buffer_pool::get();
            return Some(match bun_sys::realpath(&installed, &mut real) {
                Ok(real) => real.to_vec(),
                Err(_) => installed.as_bytes().to_vec(),
            });
        }
        let parent = resolve_path::dirname::<bun_path::platform::Auto>(ancestor);
        if parent.len() >= ancestor.len() || parent.is_empty() {
            return None;
        }
        ancestor = strings::without_trailing_slash(parent);
    }
}

// Whether the folder is a package: it has a package.json with a name.
fn holds_named_manifest(folder: &[u8]) -> bool {
    let manifest = [folder, b"/package.json"].concat();
    File::read_from(Fd::cwd(), &manifest).is_ok_and(|text| strings::contains(&text, b"\"name\""))
}

// The files with code below `root` whose paths from there begin with `start` and end with `end`. As the build walks: not what is
// installed below it, no folder whose name begins with a dot, no package below it.
fn add_files_below(root: &[u8], start: &[u8], end: &[u8], found: &mut Vec<Box<[u8]>>) {
    const EXTENSIONS: [&[u8]; 8] = [
        b".ts", b".tsx", b".js", b".jsx", b".mjs", b".cjs", b".mts", b".cts",
    ];
    let mut folders: Vec<Vec<u8>> = vec![Vec::new()];
    while let Some(relative) = folders.pop() {
        let path = bun_core::ZBox::from_bytes([root, &relative[..]].concat());
        let flags = bun_sys::O::RDONLY | bun_sys::O::DIRECTORY;
        let Ok(folder) = bun_sys::openat(Fd::cwd(), &path, flags, 0) else {
            continue;
        };
        let _close = bun_sys::CloseOnDrop::new(folder);
        let mut entries = bun_sys::dir_iterator::iterate(folder);
        while let Ok(Some(entry)) = entries.next() {
            let name = entry.name.slice_u8();
            let below = [&relative[..], b"/", name].concat();
            // Without the slash in front.
            let written = &below[1..];
            let may_match = written.starts_with(start) || start.starts_with(written);
            match entry.kind {
                bun_sys::EntryKind::Directory
                    if name != b"node_modules"
                        && !name.starts_with(b".")
                        && may_match
                        && !holds_named_manifest(&[root, &below[..]].concat()) =>
                {
                    folders.push(below);
                }
                bun_sys::EntryKind::File
                    if written.starts_with(start)
                        && written.len() >= start.len() + end.len()
                        && written.ends_with(end)
                        && EXTENSIONS.iter().any(|it| name.ends_with(it))
                        && !name.ends_with(b".d.ts") =>
                {
                    found.push([root, &below[..]].concat().into_boxed_slice());
                }
                _ => {}
            }
        }
    }
}

// The files that `import(`<prefix>${..}<suffix>`)` in a file of `folder` may stand for.
fn add_files_behind_pattern(
    folder: &[u8],
    prefix: &[u8],
    suffix: &[u8],
    found: &mut Vec<Box<[u8]>>,
) {
    let folder = strings::without_trailing_slash(folder);
    let Some(slash) = strings::last_index_of_char(prefix, b'/') else {
        return;
    };
    let (written_folder, start) = (&prefix[..slash], &prefix[slash + 1..]);
    let root = match prefix {
        // `/` alone means nothing: a name that is made when the program runs.
        [b'/', ..] => (!written_folder.is_empty()).then(|| written_folder.to_vec()),
        // As long as it stays in the package of the file.
        [b'.', ..] => {
            let joined = resolve_path::join_abs_string::<bun_path::platform::Auto>(
                folder,
                &[written_folder],
            )
            .to_vec();
            let mut package = folder;
            while !holds_named_manifest(package) {
                let parent = resolve_path::dirname::<bun_path::platform::Auto>(package);
                let parent = strings::without_trailing_slash(parent);
                if parent.len() >= package.len() || parent.is_empty() {
                    break;
                }
                package = parent;
            }
            joined.starts_with(package).then_some(joined)
        }
        _ => {
            let parts_of_name = if prefix.starts_with(b"@") { 2 } else { 1 };
            let mut slashes = (0..written_folder.len())
                .filter(|&at| written_folder[at] == b'/')
                .chain([written_folder.len()]);
            slashes.nth(parts_of_name - 1).and_then(|end_of_name| {
                let package = find_folder_of_package(folder, &written_folder[..end_of_name])?;
                Some([&package[..], &written_folder[end_of_name..]].concat())
            })
        }
    };
    if let Some(root) = root {
        add_files_below(strings::without_trailing_slash(&root), start, suffix, found);
    }
}

struct BehindComputedImports {
    import_count: usize,
    files: Vec<Box<[u8]>>,
    of_packages: Vec<Box<[u8]>>,
}

fn find_what_stands_behind_computed_imports(
    vm: &mut VirtualMachine,
    above: Vec<Box<[u8]>>,
) -> BehindComputedImports {
    let named_otherwise = FILES_NAMED_OTHERWISE_THAN_BY_IMPORT.lock().len();
    let required = FILES_REQUIRED.lock().len();
    let (_, files) = find_files_of_packages_reached_from(vm, above);
    FILES_NAMED_OTHERWISE_THAN_BY_IMPORT
        .lock()
        .truncate(named_otherwise);
    FILES_REQUIRED.lock().truncate(required);
    let mut found = Vec::new();
    let patterns_of_files = find_names_in(&files, for_each_pattern_that_loads);
    let mut import_count = 0;
    for (file, patterns) in files.iter().zip(patterns_of_files) {
        let folder = resolve_path::dirname::<bun_path::platform::Auto>(file);
        for pattern in patterns {
            if let Some((prefix, suffix)) = strings::split_once_char(&pattern, 0) {
                import_count += 1;
                add_files_behind_pattern(folder, prefix, suffix, &mut found);
            }
        }
    }
    found.retain(|path| strings::contains(path, b"/node_modules/"));
    found.sort_unstable();
    found.dedup();
    BehindComputedImports {
        import_count,
        files,
        of_packages: found,
    }
}

fn take_what_run_found_behind_computed_imports(
    above: &[Box<[u8]>],
    why_not: &mut String,
) -> Option<BehindComputedImports> {
    fn sorted(paths: &[Box<[u8]>]) -> Vec<&[u8]> {
        let mut paths: Vec<&[u8]> = paths.iter().map(|path| &**path).collect();
        paths.sort_unstable();
        paths
    }
    why_not.clear();
    why_not.push_str("the run has handed over nothing");
    let lists = run_compiled::take_lists_handed_by_run()?;
    *why_not = format!("the run has handed over {} lists", lists.len());
    let mut lists = lists.into_iter();
    let (Some(import_count), Some(files), Some(of_packages), None) =
        (lists.next(), lists.next(), lists.next(), lists.next())
    else {
        return None;
    };
    *why_not = format!(
        "the run went out from other files than the {} of this build",
        above.len(),
    );
    let of_run = &files[..above.len().min(files.len())];
    if sorted(of_run) != sorted(above) {
        return None;
    }
    why_not.clear();
    why_not.push_str("the run has handed over no number of imports");
    let import_count = bun_core::fmt::parse_int::<usize>(import_count.first()?, 10).ok()?;
    Some(BehindComputedImports {
        import_count,
        files,
        of_packages,
    })
}

fn find_files_of_packages_that_computed_imports_reach(
    vm: &mut VirtualMachine,
    above: Vec<Box<[u8]>>,
) -> (Vec<Box<[u8]>>, Vec<Box<[u8]>>) {
    let mut why_not = String::new();
    let BehindComputedImports {
        import_count,
        files,
        of_packages: mut found,
    } = match take_what_run_found_behind_computed_imports(&above, &mut why_not) {
        Some(found) => found,
        None => {
            run_compiled::log_step_of_build(&format!("{why_not}: the files are read"));
            find_what_stands_behind_computed_imports(vm, above)
        }
    };
    let all = found.len();
    found.retain(|path| !run_compiled::is_module_below_test_part(path));
    run_compiled::log_step_of_build(&format!(
        "what computed imports reach is found: {} imports in {} files stand for {} files of packages, {} of them in no program below",
        import_count,
        files.len(),
        all,
        found.len(),
    ));
    (found, files)
}

// For a build that begins while the program of what computed imports reach is still being built below it
// (`run_compiled::begins_beside_build_below`). It guesses what that program will hold: what its build begins with. Both builds
// have to fit into the memory that the run can get, up to where this one waits. Where they do not, it waits at once.
fn begin_beside_build_of_what_computed_imports_reach(
    vm: &mut VirtualMachine,
    ctx: &crate::cli::command::ContextData,
    test_files: &[Box<[u8]>],
) {
    let above = test_files.iter().chain(&ctx.preloads).cloned().collect();
    let (guess, files) = find_files_of_packages_that_computed_imports_reach(vm, above);
    let bytes_of = |files: &mut dyn Iterator<Item = &Box<[u8]>>| -> u64 {
        files
            .filter_map(|path| bun_sys::stat(&bun_core::ZBox::from_bytes(path)).ok())
            .map(|stat| stat.st_size as u64)
            .sum()
    };
    let test_files: std::collections::BTreeSet<&[u8]> =
        test_files.iter().map(|path| &**path).collect();
    let needed_below = bytes_of(&mut guess.iter()) * run_compiled::BYTES_HELD_FOR_A_BYTE_OF_SOURCE;
    let needed_here = bytes_of(&mut files.iter().filter(|path| !test_files.contains(&***path)))
        * run_compiled::BYTES_HELD_WHEN_MODULES_ARE_BOUND;
    let memory = crate::cli::test::memory_of_job::find(ctx.test_options.aot_memory_limit);
    run_compiled::log_step_of_build(&format!(
        "it begins beside the build below: that one may take {} MB, this one {} MB until it waits, the run can get {} MB",
        needed_below >> 20,
        needed_here >> 20,
        memory >> 20,
    ));
    run_compiled::guess_what_program_below_holds(guess);
    if needed_below + needed_here > memory {
        run_compiled::wait_for_program_below();
    }
}

fn note_files_that_require_loads(paths: &[Box<[u8]>], imports: &[Vec<u32>], ways: &[Vec<u8>]) {
    let is_module = |file: usize| {
        paths[file].ends_with(b".mjs")
            || paths[file].ends_with(b".mts")
            || ways[file].iter().any(|way| way & BY_STATEMENT != 0)
    };
    let mut is_named_otherwise = vec![false; paths.len()];
    let mut is_required = vec![false; paths.len()];
    let mut runs_inside_require = vec![false; paths.len()];
    let mut to_visit: Vec<u32> = Vec::new();
    for (imported, ways) in imports.iter().zip(ways) {
        for (&target, &way) in imported.iter().zip(ways) {
            let at = target as usize;
            is_named_otherwise[at] |= way & (BY_REQUIRE | BY_WORKER) != 0;
            if way & BY_REQUIRE == 0 {
                continue;
            }
            is_required[at] = true;
            if is_module(at) && !core::mem::replace(&mut runs_inside_require[at], true) {
                to_visit.push(target);
            }
        }
    }
    while let Some(file) = to_visit.pop() {
        for &target in &imports[file as usize] {
            let at = target as usize;
            is_named_otherwise[at] = true;
            is_required[at] = true;
            if !core::mem::replace(&mut runs_inside_require[at], true) {
                to_visit.push(target);
            }
        }
    }
    let marked = |marks: Vec<bool>| {
        let marked = paths.iter().zip(marks);
        marked
            .filter(|&(_, is_marked)| is_marked)
            .map(|(path, _)| path.clone())
    };
    FILES_NAMED_OTHERWISE_THAN_BY_IMPORT
        .lock()
        .extend(marked(is_named_otherwise));
    FILES_REQUIRED.lock().extend(marked(is_required));
}

fn find_all_that_is_reached_from(
    vm: &mut VirtualMachine,
    above: Vec<Box<[u8]>>,
) -> (Vec<Box<[u8]>>, Vec<Vec<u32>>, Vec<u64>) {
    const EXTENSIONS: [&[u8]; 8] = [
        b".ts", b".tsx", b".js", b".jsx", b".mjs", b".cjs", b".mts", b".cts",
    ];
    let mut unread_log = bun_ast::Log::init();
    // SAFETY: the resolver and `unread_log` outlive the guard.
    let _log_scope = unsafe {
        bun_resolver::Resolver::scoped_log(
            &raw mut vm.transpiler.resolver,
            core::ptr::NonNull::from(&mut unread_log),
        )
    };
    let mut position_of = bun_collections::StringHashMap::<u32>::default();
    let mut paths = above;
    for (position, path) in paths.iter().enumerate() {
        let _ = position_of.put(path, position as u32);
    }
    let mut imports: Vec<Vec<u32>> = Vec::new();
    let mut sizes: Vec<u64> = Vec::new();
    let mut resolved = bun_collections::StringHashMap::<Option<u32>>::default();
    let mut asked: Vec<u8> = Vec::new();
    while imports.len() < paths.len() {
        let first = imports.len();
        let (names_of_level, mut sizes_of_level) = find_names_and_sizes_in(
            &paths[first..],
            match first {
                0 => for_each_name_that_loads,
                _ => for_each_name_that_build_follows,
            },
        );
        sizes.append(&mut sizes_of_level);
        for (file, names) in (first..).zip(names_of_level) {
            let folder = resolve_path::dirname::<bun_path::platform::Auto>(&paths[file]).to_vec();
            let mut place = |path: Box<[u8]>| match position_of.get(&*path) {
                Some(&position) => position,
                None => {
                    let position = paths.len() as u32;
                    let _ = position_of.put(&path, position);
                    paths.push(path);
                    position
                }
            };
            let mut loaded: Vec<u32> = Vec::new();
            let mut behind_pattern: Vec<Box<[u8]>> = Vec::new();
            for marked in names {
                let name = &marked[1..];
                if let Some((prefix, suffix)) = strings::split_once_char(name, 0) {
                    add_files_behind_pattern(&folder, prefix, suffix, &mut behind_pattern);
                    loaded.extend(behind_pattern.drain(..).map(&mut place));
                    continue;
                }
                asked.clear();
                asked.extend_from_slice(&folder);
                asked.push(0);
                asked.extend_from_slice(name);
                if let Some(&position) = resolved.get(&asked[..]) {
                    loaded.extend(position);
                    continue;
                }
                let kind = bun_ast::ImportKind::Stmt;
                let result = vm.transpiler.resolver.resolve(&folder, name, kind).ok();
                let path = result.as_ref().map(|it| it.path_pair.primary.text());
                let is_code = |path: &&[u8]| {
                    bun_path::is_absolute(path)
                        && EXTENSIONS.iter().any(|extension| path.ends_with(extension))
                };
                let position = path.filter(is_code).map(|path| place(Box::from(path)));
                let _ = resolved.put(&asked, position);
                loaded.extend(position);
            }
            let mut imported: Vec<u32> = Vec::new();
            for position in loaded {
                if position as usize != file && !imported.contains(&position) {
                    imported.push(position);
                }
            }
            imports.push(imported);
        }
    }
    (paths, imports, sizes)
}

const MICROSECONDS_OF_TEST_FILES_FOR_THOUSAND_BYTES_TO_BUILD: u64 = 8300;

static BYTES_THAT_SHARD_REACHES: core::sync::atomic::AtomicU64 =
    core::sync::atomic::AtomicU64::new(0);

fn select_shard_by_reach(
    vm: &mut VirtualMachine,
    ctx: &crate::cli::command::ContextData,
    test_files: &mut [Interned],
    shard: bun_options_types::context::Shard,
    timings: Option<&Timings>,
) -> usize {
    use crate::cli::test::shards_by_reach::{Costs, Reach, deal};
    index_sort::sort_slice_by(test_files, |a, b| {
        strings::order(a.as_bytes(), b.as_bytes())
    });
    let (tests, shards) = (test_files.len(), shard.count as usize);
    let otherwise: Vec<u32> = match timings {
        Some(timings) => {
            let ranges = timings.partition(test_files, shard.count);
            let shard_of = |test: u32| ranges.iter().position(|it| it.lo <= test && test < it.hi);
            (0..tests as u32)
                .map(|test| shard_of(test).unwrap_or(0) as u32)
                .collect()
        }
        None => (0..tests).map(|test| (test % shards) as u32).collect(),
    };
    let mut above: Vec<Box<[u8]>> = (test_files.iter())
        .map(|path| Box::from(path.as_bytes()))
        .collect();
    let mut preloads: Vec<u32> = Vec::new();
    for path in find_files_of_preloads(vm, &ctx.preloads) {
        let position = above.iter().position(|other| **other == *path);
        preloads.push(position.unwrap_or(above.len()) as u32);
        if position.is_none() {
            above.push(path);
        }
    }
    let (paths, imports, sizes) = find_all_that_is_reached_from(vm, above);
    run_compiled::log_step_of_test_run(format_args!(
        "what the test files of all {shards} shards reach is found: {} files",
        paths.len() - tests
    ));
    let at_once = timings.map_or(0, |timings| u64::from(timings.workers()));
    let of_run: Vec<u64> = match timings {
        Some(timings) => (timings.costs(test_files).into_iter())
            .map(|milliseconds| (milliseconds * 1000).max(1))
            .collect(),
        None => vec![1; tests],
    };
    let of_heavy: Vec<u32> = (test_files.iter())
        .map(|file| {
            let heavy = timings.filter(|timings| timings.is_heavy(file.as_bytes()));
            heavy.and_then(|timings| timings.growth_of(file.as_bytes()))
        })
        .map(|megabytes| megabytes.unwrap_or(0))
        .collect();
    let costs = Costs {
        of_run: &of_run,
        of_thousand_bytes: match at_once {
            0 => 0,
            _ => MICROSECONDS_OF_TEST_FILES_FOR_THOUSAND_BYTES_TO_BUILD,
        },
        at_once,
        of_heavy: &of_heavy,
    };
    let reach = Reach {
        test_count: tests,
        imports: &imports,
        sizes: &sizes,
        preloads: &preloads,
    };
    let dealt = deal(&reach, &costs, shards, otherwise);
    let mine = shard.index - 1;
    run_compiled::log_step_of_test_run(format_args!(
        "the shards are dealt by what the test files reach: this one builds {} KB, the others {:?} | the longest takes {}",
        dealt.bytes_of[mine as usize] / 1000,
        (dealt.bytes_of.iter().enumerate())
            .filter(|&(other, _)| other != mine as usize)
            .map(|(_, bytes)| bytes / 1000)
            .collect::<Vec<u64>>(),
        dealt.longest,
    ));
    if !run_compiled::is_second_process() {
        let mix = |hash: u64, &shard: &u32| (hash ^ u64::from(shard)).wrapping_mul(0x100_0000_01b3);
        pretty_error!(
            "<r><d>--shard: dealt by what the test files reach, the same on every shard: {:016x}<r>\n",
            dealt.shard_of.iter().fold(0xcbf2_9ce4_8422_2325, mix)
        );
    }
    let mut write = 0;
    let mut bytes = dealt.bytes_of[mine as usize];
    for test in 0..tests {
        if dealt.shard_of[test] == mine {
            test_files[write] = test_files[test];
            bytes += sizes[test];
            write += 1;
        }
    }
    BYTES_THAT_SHARD_REACHES.store(bytes, core::sync::atomic::Ordering::Relaxed);
    write
}

// Of the files that `above` reach and that no program below holds, the lowest, for a program of their own. No program imports from one
// above it, so a file goes when all that it imports has gone, and files that import one another in a circle go together. They go until
// `percent` of the bytes have. `above`, the test files and the preloads, stay, and so does what imports one of them.
// What the texts do not show of an import does no harm: the build follows the imports itself, and the programs above take what it ends with.
// An import of types loads nothing, so it holds no file down and closes no circle.
fn find_lowest_files_reached_from(
    vm: &mut VirtualMachine,
    above: Vec<Box<[u8]>>,
    percent: u32,
) -> Vec<Box<[u8]>> {
    const EXTENSIONS: [&[u8]; 8] = [
        b".ts", b".tsx", b".js", b".jsx", b".mjs", b".cjs", b".mts", b".cts",
    ];
    const IS_BELOW: u32 = u32::MAX;
    let mut position_of = bun_collections::StringHashMap::<u32>::default();
    let mut paths: Vec<Box<[u8]>> = Vec::new();
    for path in above {
        if !position_of.contains_key(&*path) {
            let _ = position_of.put(&path, paths.len() as u32);
            paths.push(path);
        }
    }
    let above_count = paths.len();
    let mut imports: Vec<Vec<u32>> = Vec::new();
    let mut ways_of_imports: Vec<Vec<u8>> = Vec::new();
    while imports.len() < paths.len() {
        let first = imports.len();
        // What only a test file or a preload loads in another way than by a name is built with it, as where the files of the project
        // are one program.
        let names_of_level = find_names_in(
            &paths[first..],
            match first {
                0 => for_each_name_that_loads,
                _ => for_each_name_that_build_follows,
            },
        );
        for (file, names) in (first..).zip(names_of_level) {
            let folder = resolve_path::dirname::<bun_path::platform::Auto>(&paths[file]).to_vec();
            let mut imported: Vec<u32> = Vec::new();
            let mut ways: Vec<u8> = Vec::new();
            let mut loaded: Vec<Box<[u8]>> = Vec::new();
            let mut ways_of_loaded: Vec<u8> = Vec::new();
            for marked in names {
                let (way, name) = (marked[0], &marked[1..]);
                if let Some((prefix, suffix)) = strings::split_once_char(name, 0) {
                    add_files_behind_pattern(&folder, prefix, suffix, &mut loaded);
                    ways_of_loaded.resize(loaded.len(), way);
                    continue;
                }
                let kind = bun_ast::ImportKind::Stmt;
                let Ok(result) = vm.transpiler.resolver.resolve(&folder, name, kind) else {
                    continue;
                };
                let path = result.path_pair.primary.text();
                if bun_path::is_absolute(path)
                    && EXTENSIONS.iter().any(|extension| path.ends_with(extension))
                {
                    loaded.push(Box::from(path));
                    ways_of_loaded.push(way);
                }
            }
            for (path, way) in loaded.into_iter().zip(ways_of_loaded) {
                let position = match position_of.get(&*path) {
                    Some(&position) => position,
                    None => {
                        let position = match run_compiled::is_module_below_test_part(&path) {
                            true => IS_BELOW,
                            false => paths.len() as u32,
                        };
                        let _ = position_of.put(&path, position);
                        if position != IS_BELOW {
                            paths.push(path);
                        }
                        position
                    }
                };
                if position == IS_BELOW || position as usize == file {
                    continue;
                }
                match imported.iter().position(|&other| other == position) {
                    Some(at) => ways[at] |= way,
                    None => {
                        imported.push(position);
                        ways.push(way);
                    }
                }
            }
            imports.push(imported);
            ways_of_imports.push(ways);
        }
    }
    note_files_that_require_loads(&paths, &imports, &ways_of_imports);
    let size_of = |path: &[u8]| {
        bun_sys::stat(&bun_core::ZBox::from_bytes(path)).map_or(0, |stat| stat.st_size as u64)
    };
    let sizes: Vec<u64> = paths.iter().map(|path| size_of(path)).collect();

    // The circles, each behind all that it imports.
    const UNSEEN: u32 = u32::MAX;
    let mut number = vec![UNSEEN; paths.len()];
    let mut lowest_reached = vec![0u32; paths.len()];
    let mut is_open = vec![false; paths.len()];
    let mut open: Vec<u32> = Vec::new();
    let mut circles: Vec<Vec<u32>> = Vec::new();
    let mut circle_of = vec![0u32; paths.len()];
    let mut next_number = 0;
    for root in 0..paths.len() as u32 {
        if number[root as usize] != UNSEEN {
            continue;
        }
        // The file, and how many of its imports have been followed.
        let mut walk: Vec<(u32, usize)> = vec![(root, 0)];
        while let Some(&mut (file, ref mut followed)) = walk.last_mut() {
            let at = file as usize;
            if *followed == 0 {
                number[at] = next_number;
                lowest_reached[at] = next_number;
                next_number += 1;
                open.push(file);
                is_open[at] = true;
            }
            if let Some(&imported) = imports[at].get(*followed) {
                *followed += 1;
                if number[imported as usize] == UNSEEN {
                    walk.push((imported, 0));
                } else if is_open[imported as usize] {
                    lowest_reached[at] = lowest_reached[at].min(number[imported as usize]);
                }
                continue;
            }
            walk.pop();
            if let Some(&(importer, _)) = walk.last() {
                let importer = importer as usize;
                lowest_reached[importer] = lowest_reached[importer].min(lowest_reached[at]);
            }
            if lowest_reached[at] == number[at] {
                let first = open.iter().rposition(|&other| other == file).unwrap_or(0);
                let circle = open.split_off(first);
                for &member in &circle {
                    is_open[member as usize] = false;
                    circle_of[member as usize] = circles.len() as u32;
                }
                circles.push(circle);
            }
        }
    }

    let all: u64 = sizes[above_count..].iter().sum();
    let wanted = all * u64::from(percent) / 100;
    let mut has_gone = vec![false; paths.len()];
    let mut gone = 0;
    let mut largest_circle = (0, 0);
    for (circle, own) in circles.iter().zip(0u32..) {
        let size: u64 = circle.iter().map(|&file| sizes[file as usize]).sum();
        if circle.len() > 1 && size > largest_circle.1 {
            largest_circle = (circle.len(), size);
        }
        let may_go = circle.iter().all(|&file| {
            let mut imported = imports[file as usize].iter().map(|&other| other as usize);
            file as usize >= above_count
                && imported.all(|other| has_gone[other] || circle_of[other] == own)
        });
        // Not where it would miss the mark by more than without it.
        if gone >= wanted || !may_go || (gone + size).saturating_sub(wanted) > wanted - gone {
            continue;
        }
        gone += size;
        for &file in circle {
            has_gone[file as usize] = true;
        }
    }
    // For the log: what stays above, in sets that import nothing of one another. Programs of such sets could be built side by side.
    let mut set_of: Vec<u32> = (0..paths.len() as u32).collect();
    let find_set = |set_of: &mut [u32], mut file: u32| {
        while set_of[file as usize] != file {
            set_of[file as usize] = set_of[set_of[file as usize] as usize];
            file = set_of[file as usize];
        }
        file
    };
    let stays = |file: usize| file >= above_count && !has_gone[file];
    for file in (above_count..paths.len()).filter(|&file| stays(file)) {
        for &other in imports[file].iter().filter(|&&other| stays(other as usize)) {
            let (one, two) = (
                find_set(&mut set_of, file as u32),
                find_set(&mut set_of, other),
            );
            set_of[one as usize] = two;
        }
    }
    let mut sizes_of_sets = vec![(0u64, 0u32); paths.len()];
    for file in (above_count..paths.len()).filter(|&file| stays(file)) {
        let set = &mut sizes_of_sets[find_set(&mut set_of, file as u32) as usize];
        *set = (set.0 + sizes[file], set.1 + 1);
    }
    let set_count = sizes_of_sets.iter().filter(|set| set.1 != 0).count();
    // And which of `above` could run over the programs below and this one alone. A circle comes behind all that it imports.
    let mut reaches_what_stays = vec![false; paths.len()];
    for circle in &circles {
        let reaches = circle.iter().any(|&file| {
            let mut imported = imports[file as usize].iter();
            stays(file as usize) || imported.any(|&other| reaches_what_stays[other as usize])
        });
        for &file in circle {
            reaches_what_stays[file as usize] = reaches;
        }
    }
    let need_no_more = reaches_what_stays[..above_count]
        .iter()
        .filter(|&&reaches| !reaches)
        .count();
    let largest_set = sizes_of_sets.iter().copied().max().unwrap_or_default();
    run_compiled::log_step_of_build(&format!(
        "the lowest files are found: {} of {} files, {} of {} KB, {} percent wanted | the largest circle has {} files, {} KB | what stays is {} sets that import nothing of one another, the largest {} files, {} KB | {} of the {} test files and preloads reach nothing that stays",
        has_gone.iter().filter(|&&has_gone| has_gone).count(),
        paths.len() - above_count,
        gone / 1024,
        all / 1024,
        percent,
        largest_circle.0,
        largest_circle.1 / 1024,
        set_count,
        largest_set.1,
        largest_set.0 / 1024,
        need_no_more,
        above_count,
    ));
    let chosen = paths.into_iter().zip(has_gone);
    chosen
        .filter_map(|(path, has_gone)| has_gone.then_some(path))
        .collect()
}

// What the test files and the preloads replace, for a build that does not see the test files.
// A preload is named as it was written: "./test/preload.ts", "dotenv/config". The scan looks for a file from the folder of the one that names it, and "./test"
// is no folder to the resolver, so what a preload imports would go unread: its mocks and spies.
fn find_files_of_preloads(vm: &mut VirtualMachine, preloads: &[Box<[u8]>]) -> Vec<Box<[u8]>> {
    let mut unread_log = bun_ast::Log::init();
    // SAFETY: the resolver and `unread_log` outlive the guard.
    let _log_scope = unsafe {
        bun_resolver::Resolver::scoped_log(
            &raw mut vm.transpiler.resolver,
            core::ptr::NonNull::from(&mut unread_log),
        )
    };
    let top = FileSystem::get().top_level_dir();
    let mut file_of = |name: &[u8]| -> Box<[u8]> {
        let kind = bun_ast::ImportKind::Stmt;
        match vm.transpiler.resolver.resolve(top, name, kind) {
            Ok(found) if bun_path::is_absolute(found.path_pair.primary.text()) => {
                Box::from(found.path_pair.primary.text())
            }
            // Whoever loads it says what is wrong with it.
            _ => Box::from(name),
        }
    };
    preloads.iter().map(|name| file_of(name)).collect()
}

fn find_what_tests_replace<Path: core::ops::Deref<Target = [u8]>>(
    vm: &mut VirtualMachine,
    test_files: &[Path],
    files_reached_from_them: &[Box<[u8]>],
    reached_by_preloads_alone: &[Box<[u8]>],
    preloads: &[Box<[u8]>],
    product_replaces_nothing: bool,
    has_file_with_window: bool,
) -> ReplacedByTests {
    let test_files: Vec<Vec<u8>> = test_files.iter().map(|path| path.to_vec()).collect();
    find_what_files_replace(
        vm,
        &test_files,
        files_reached_from_them,
        reached_by_preloads_alone,
        preloads,
        product_replaces_nothing,
        has_file_with_window,
    )
}

fn find_what_files_replace(
    vm: &mut VirtualMachine,
    test_files: &[Vec<u8>],
    files_reached_from_them: &[Box<[u8]>],
    reached_by_preloads_alone: &[Box<[u8]>],
    preloads: &[Box<[u8]>],
    product_replaces_nothing: bool,
    has_file_with_window: bool,
) -> ReplacedByTests {
    let preloads = find_files_of_preloads(vm, preloads);
    // Every name that a test file or a helper imports is asked for, and whoever loads the file says what is wrong with one.
    let mut unread_log = bun_ast::Log::init();
    // SAFETY: the resolver and `unread_log` outlive the guard.
    let _log_scope = unsafe {
        bun_resolver::Resolver::scoped_log(
            &raw mut vm.transpiler.resolver,
            core::ptr::NonNull::from(&mut unread_log),
        )
    };
    let others = files_reached_from_them.iter().chain(&preloads);
    let others: Vec<Vec<u8>> = others.map(|path| path.to_vec()).collect();
    let reached_by_preloads_alone: Vec<Vec<u8>> = (reached_by_preloads_alone.iter())
        .map(|path| path.to_vec())
        .collect();
    let threads = usize::from(bun_core::get_thread_count());
    let resolve = &mut |importer: &[u8], specifier: &[u8], is_for_require: bool| {
        let folder = resolve_path::dirname::<bun_path::platform::Auto>(importer);
        let kind = match is_for_require {
            true => bun_ast::ImportKind::RequireResolve,
            false => bun_ast::ImportKind::Stmt,
        };
        let result = vm
            .transpiler
            .resolver
            .resolve(folder, specifier, kind)
            .ok()?;
        Some(result.path_pair.primary.text().to_vec())
    };
    let mut replaced = bun_aot::builtins::find_what_tests_replace(
        test_files,
        &others,
        &reached_by_preloads_alone,
        threads,
        product_replaces_nothing,
        resolve,
    );
    if has_file_with_window {
        replaced
            .builtins
            .extend(bun_aot::builtins::globals_that_a_window_replaces());
        replaced.builtins.sort_unstable();
        replaced.builtins.dedup();
    }
    replaced
}

// A trial. The build does not see the test files. This file stands in for what they do: it loads code under names that nothing says. The condition is one that flow cannot
// fold: it proves a load of a name that is never set dead, and the option that admits an inspector instead costs 3.4 times the run (classes and prototype chains made one by one).
// `spelled`: `find_library_modules_spelled_from`.
fn make_stand_in_for_files_from_disk(
    holds_library: bool,
    spelled: Option<&bun_collections::StringSet>,
) -> Box<[u8]> {
    let mut text = b"const other = process.argv.at(-1)!;
if (other === \"\\0never\") {
  await import(other);
  require(other);
}
"
    .to_vec();
    // They import any module of Bun's own code too. Only the first image holds such modules, and one that it does not hold would run in the interpreter.
    let mut library_modules = match holds_library {
        true => bun_aot::builtins::library_modules_that_programs_load(),
        false => Vec::new(),
    };
    if let Some(spelled) = spelled {
        library_modules.retain(|specifier| spelled.contains(specifier));
    }
    for specifier in library_modules {
        text.extend_from_slice(b"if (other === \"\\0never\") require(\"");
        text.extend_from_slice(specifier);
        text.extend_from_slice(b"\");\n");
    }
    // Some it holds for native code alone, which loads them where a program reads a built-in.
    let mut builtins = match holds_library {
        true => bun_aot::builtins::builtins_that_load_library_modules(),
        false => Vec::new(),
    };
    if let Some(spelled) = spelled {
        builtins.retain(|builtin| spelled.contains(builtin.as_bytes()));
    }
    for builtin in builtins {
        // The declarations leave some of them out.
        let Some((global, members)) = strings::split_once_char(builtin.as_bytes(), b'.') else {
            continue;
        };
        text.extend_from_slice(b"if (other === \"\\0never\") void (");
        text.extend_from_slice(global);
        text.extend_from_slice(b" as any).");
        text.extend_from_slice(members);
        text.extend_from_slice(b";\n");
    }
    // The name of the module. No file is there.
    let path = resolve_path::join_abs_string::<bun_path::platform::Auto>(
        FileSystem::get().top_level_dir(),
        &[b"node_modules/.cache/bun-test-files-from-disk.ts"],
    )
    .to_vec();
    run_compiled::set_stand_in(&path, &text);
    path.into_boxed_slice()
}

// One thing that the text of a test file says about a module or about an object that stands for one.
enum NamedByTest<'a> {
    Export {
        specifier: &'a [u8],
        name: &'a [u8],
    },
    // `import * as local`, `export *`, `require()`, `import()`
    Namespace {
        specifier: &'a [u8],
        local: Option<&'a [u8]>,
        is_required: bool,
    },
    // "./x": a string that may be a path, wherever it stands.
    Spelled {
        specifier: &'a [u8],
    },
    // `delete require.cache[require.resolve("x")]`, `delete require.cache["x"]`. No specifier: a key that the text does not spell.
    Eviction {
        specifier: Option<&'a [u8]>,
    },
    // `import "x"`
    File {
        specifier: &'a [u8],
    },
    Mock {
        specifier: &'a [u8],
    },
    // `typeof import("x")`, `import("x").Shape`: it takes nothing of x, and the string is no path that goes somewhere.
    Type {
        specifier: &'a [u8],
    },
    Spy {
        local: &'a [u8],
        name: &'a [u8],
    },
}

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

fn skip_space(text: &[u8], at: usize) -> usize {
    text.len() - text[at..].trim_ascii_start().len()
}

fn read_identifier(text: &[u8], at: usize) -> Option<(&[u8], usize)> {
    let bytes = text[at..].iter();
    let length = bytes.take_while(|&&byte| is_identifier_byte(byte)).count();
    (length > 0).then(|| (&text[at..at + length], at + length))
}

// What stands between two of `quotes` on one line, and where the text goes on.
fn read_string<'a>(text: &'a [u8], at: usize, quotes: &[u8]) -> Option<(&'a [u8], usize)> {
    let (quote, rest) = text[at..].split_first()?;
    if !quotes.contains(quote) {
        return None;
    }
    let end = strings::index_of_any(rest, &[*quote, b'\n'])?;
    (end > 0 && rest[end] == *quote).then(|| (&rest[..end], at + end + 2))
}

// `a, { b, c as d } from "x"`, `* as n from "x"`, `* from "x"`, `"x"`: what follows `import` or `export`. Nothing of a declaration of types.
fn read_import_declaration<'a>(
    text: &'a [u8],
    at: usize,
    visit: &mut dyn FnMut(NamedByTest<'a>),
) -> Option<()> {
    let mut at = skip_space(text, at);
    if let Some((specifier, _)) = read_string(text, at, b"\"'") {
        visit(NamedByTest::File { specifier });
        return Some(());
    }
    let mut names: Vec<&'a [u8]> = Vec::new();
    let mut namespace: Option<Option<&'a [u8]>> = None;
    if let Some((word, next)) = read_identifier(text, at) {
        at = skip_space(text, next);
        let is_name = text[at..].starts_with(b",") || text[at..].starts_with(b"from");
        if word == b"type" && !is_name {
            return None;
        }
        names.push(b"default");
        if text[at..].starts_with(b",") {
            at = skip_space(text, at + 1);
        }
    }
    match text.get(at) {
        Some(b'{') => {
            let end = at + strings::index_of_char_usize(&text[at..], b'}')?;
            for part in strings::split(&text[at + 1..end], b",") {
                let part = part.trim_ascii();
                let name = read_identifier(part, 0).or_else(|| read_string(part, 0, b"\"'"));
                let Some((name, next)) = name else {
                    continue;
                };
                let rest = part[next..].trim_ascii_start();
                if name != b"type" || rest.is_empty() || rest.starts_with(b"as ") {
                    names.push(name);
                }
            }
            at = end + 1;
        }
        Some(b'*') => {
            at = skip_space(text, at + 1);
            namespace = Some(None);
            if text[at..].starts_with(b"as") {
                let (local, next) = read_identifier(text, skip_space(text, at + 2))?;
                namespace = Some(Some(local));
                at = next;
            }
        }
        _ => {}
    }
    at = skip_space(text, at);
    if !text[at..].starts_with(b"from") {
        return None;
    }
    let (specifier, _) = read_string(text, skip_space(text, at + 4), b"\"'")?;
    for name in names {
        visit(NamedByTest::Export { specifier, name });
    }
    if let Some(local) = namespace {
        visit(NamedByTest::Namespace {
            specifier,
            local,
            is_required: false,
        });
    }
    Some(())
}

// `import .. from "x"`, `import "x"`, `export .. from "x"`: the names without which the file does not load. Reads words, not syntax: the word has to
// begin its line. A sentence in a comment or a string, ` * import { a } from "./gone.js"`, is no statement, and who takes it for one takes the file
// and all that imports it out of the program.
fn for_each_name_in_statement<'a>(text: &'a [u8], mut visit: impl FnMut(&'a [u8])) {
    let mut at = 0;
    while let Some(found) = strings::index_of_any(&text[at..], b"ie") {
        at += found;
        let blanks = text[..at].trim_ascii_end().len();
        let begins_line = blanks == 0 || strings::contains_char(&text[blanks..at], b'\n');
        let is_word = text[at..].starts_with(b"import") || text[at..].starts_with(b"export");
        at += 1;
        if !begins_line || !is_word {
            continue;
        }
        let _ = read_import_declaration(text, at + 5, &mut |named| match named {
            NamedByTest::Export { specifier, .. }
            | NamedByTest::Namespace { specifier, .. }
            | NamedByTest::File { specifier } => visit(specifier),
            _ => {}
        });
    }
}

// The names that the text reads off `local`, which stands for the object of a module: `local.a`, `local?.a`, `local["a"]`. `spyOn(local, "a")` and `typeof local` read
// none. Nothing where the object itself goes somewhere: whoever gets it may read any name. Reads words, not syntax; a word beside `/`, `-` or a quote is part of a path or of
// prose in a string, and one in front of `:` behind `{` or `,` is a key. A use that this takes for none of the object is refused by name where it reads.
fn find_names_read_off<'a>(text: &'a [u8], local: &[u8]) -> Option<Vec<&'a [u8]>> {
    let mut names = Vec::new();
    let mut at = 0;
    while let Some(found) = strings::index_of(&text[at..], local) {
        let start = at + found;
        at = start + local.len();
        let before = text[..start].trim_ascii_end();
        let is_spread = before.ends_with(b"...");
        let is_whole_word = !text.get(at).is_some_and(|&byte| is_identifier_byte(byte))
            && !(text[..start].last()).is_some_and(|&byte| is_identifier_byte(byte))
            && (is_spread || !before.ends_with(b"."));
        if !is_whole_word {
            continue;
        }
        let stands_in_words =
            |byte: Option<&u8>| matches!(byte, Some(b'/' | b'-' | b'"' | b'\'' | b'`'));
        if stands_in_words(text[..start].last()) || stands_in_words(text.get(at)) {
            continue;
        }
        let after = skip_space(text, at);
        let rest = &text[after..];
        let member = (rest.strip_prefix(b"?.").or_else(|| rest.strip_prefix(b".")))
            .filter(|_| !is_spread)
            .map(|member| text.len() - member.trim_ascii_start().len());
        if let Some((name, _)) = member.and_then(|member| read_identifier(text, member)) {
            names.push(name);
            continue;
        }
        if !is_spread && rest.starts_with(b"[") {
            if let Some((name, next)) = read_string(text, skip_space(text, after + 1), b"\"'") {
                if text.get(skip_space(text, next)) == Some(&b']') {
                    names.push(name);
                    continue;
                }
            }
        }
        let ends_with_word = |word: &[u8]| {
            (before.strip_suffix(word))
                .is_some_and(|rest| !rest.last().is_some_and(|&byte| is_identifier_byte(byte)))
        };
        let is_stored_to = rest.starts_with(b"=") && !matches!(rest.get(1), Some(b'=' | b'>'));
        let is_declared = (ends_with_word(b"as") && rest.starts_with(b"from"))
            || (!is_spread && is_stored_to)
            || [&b"const"[..], b"let", b"var"]
                .into_iter()
                .any(ends_with_word);
        let is_spied_on = ends_with_word(b"spyOn(")
            && (rest.strip_prefix(b","))
                .is_some_and(|rest| matches!(rest.trim_ascii_start().first(), Some(b'"' | b'\'')));
        let is_key = rest.starts_with(b":") && (before.ends_with(b"{") || before.ends_with(b","));
        if !(is_declared || is_spied_on || is_key || ends_with_word(b"typeof")) {
            return None;
        }
    }
    Some(names)
}

fn strip_word<'a>(text: &'a [u8], word: &[u8]) -> Option<&'a [u8]> {
    let rest = text.strip_suffix(word)?;
    (!rest.last().is_some_and(|&byte| is_identifier_byte(byte))).then(|| rest.trim_ascii_end())
}

// `.a`, `?.a`, `["a"]`
fn read_member(text: &[u8], at: usize) -> Option<&[u8]> {
    let rest = &text[at..];
    if let Some(member) = rest.strip_prefix(b"?.").or_else(|| rest.strip_prefix(b".")) {
        return Some(read_identifier(text, text.len() - member.trim_ascii_start().len())?.0);
    }
    let (name, next) = read_string(
        text,
        skip_space(text, at + rest.strip_prefix(b"[").map(|_| 1)?),
        b"\"'",
    )?;
    (text.get(skip_space(text, next)) == Some(&b']')).then_some(name)
}

// `a, b: c, d = 1`: the keys of a pattern between braces. Nothing where it takes the rest, a key that is computed, or has a pattern within.
fn read_keys_of_pattern(pattern: &[u8]) -> Option<Vec<&[u8]>> {
    let mut keys = Vec::new();
    for item in strings::split(pattern, b",") {
        let start = skip_space(item, 0);
        if start == item.len() {
            continue;
        }
        let (key, next) =
            read_identifier(item, start).or_else(|| read_string(item, start, b"\"'"))?;
        if !matches!(item.get(skip_space(item, next)), None | Some(b':' | b'=')) {
            return None;
        }
        keys.push(key);
    }
    (!strings::contains_char(pattern, b'{') && !strings::contains_char(pattern, b'}'))
        .then_some(keys)
}

// What a test file takes of `import("x")` or `require("x")`. The word stands at `start`, and `end` is behind the string. Where the text does not say, all of it.
fn read_load<'a>(
    text: &'a [u8],
    (start, end): (usize, usize),
    specifier: &'a [u8],
    is_required: bool,
    visit: &mut dyn FnMut(NamedByTest<'a>),
) {
    let object = |local| NamedByTest::Namespace {
        specifier,
        local,
        is_required,
    };
    let close = skip_space(text, end);
    let mut before = text[..start].trim_ascii_end();
    if text.get(close) != Some(&b')') || strings::contains_char(specifier, b'?') {
        return visit(object(None));
    }
    if strip_word(before, b"typeof").is_some() {
        return visit(NamedByTest::Type { specifier });
    }
    let after = skip_space(text, close + 1);
    if is_required {
        if let Some(name) = read_member(text, after) {
            return visit(NamedByTest::Export { specifier, name });
        }
    } else {
        let Some(rest) = strip_word(before, b"await") else {
            // A promise has three members: `import("x").Shape` is a type too.
            const OF_PROMISE: [&[u8]; 3] = [b"then", b"catch", b"finally"];
            return match read_member(text, after) {
                Some(name) if !OF_PROMISE.contains(&name) => visit(NamedByTest::Type { specifier }),
                _ => visit(object(None)),
            };
        };
        before = rest;
        if before.ends_with(b"(") && text.get(after) == Some(&b')') {
            return match read_member(text, skip_space(text, after + 1)) {
                Some(name) => visit(NamedByTest::Export { specifier, name }),
                None => visit(object(None)),
            };
        }
    }
    // `await import("x").then(..)`, `require("x")(..)`: what is stored is something else.
    if matches!(text.get(after), Some(b'.' | b'?' | b'[' | b'(' | b'!')) {
        return visit(object(None));
    }
    let is_store = |rest: &&[u8]| {
        !rest
            .last()
            .is_some_and(|byte| b"=!<>+-*/%&|^?".contains(byte))
    };
    let Some(target) = before.strip_suffix(b"=").filter(is_store) else {
        return visit(object(None));
    };
    let target = target.trim_ascii_end();
    let declares = |head: &[u8]| {
        [&b"const"[..], b"let", b"var"]
            .into_iter()
            .any(|word| strip_word(head, word).is_some())
    };
    if let Some(pattern) = target.strip_suffix(b"}") {
        let keys = strings::last_index_of_char(pattern, b'{')
            .filter(|&open| declares(pattern[..open].trim_ascii_end()))
            .and_then(|open| read_keys_of_pattern(&pattern[open + 1..]));
        let Some(keys) = keys else {
            return visit(object(None));
        };
        visit(NamedByTest::File { specifier });
        for name in keys {
            visit(NamedByTest::Export { specifier, name });
        }
        return;
    }
    let length = target
        .iter()
        .rev()
        .take_while(|&&byte| is_identifier_byte(byte))
        .count();
    let (head, local) = target.split_at(target.len() - length);
    // `holder.m = ..`, `const m: Shape = ..`
    let stands_alone = !matches!(head.trim_ascii_end().last(), Some(b'.' | b':'));
    visit(object((length > 0 && stands_alone).then_some(local)));
}

// Reads words, not syntax: also in a comment and in code that a test holds as a string. One too many names an export too many.
fn for_each_named_by_test<'a>(text: &'a [u8], visit: &mut dyn FnMut(NamedByTest<'a>)) {
    #[derive(Clone, Copy, PartialEq)]
    enum Word {
        Declares,
        DeclaresOrLoads,
        Loads,
        Requires,
        Mocks,
        Spies,
        Deletes,
    }
    // A word that begins with another one stands before it.
    const WORDS: [(&[u8], Word); 10] = [
        (b"export", Word::Declares),
        (b"import.meta.resolve", Word::Loads),
        (b"import", Word::DeclaresOrLoads),
        (b"require.resolve", Word::Requires),
        (b"require", Word::Requires),
        (b"delete", Word::Deletes),
        (b"mock.module", Word::Mocks),
        (b"jest.mock", Word::Mocks),
        (b"vi.mock", Word::Mocks),
        (b"spyOn", Word::Spies),
    ];
    let mut at = 0;
    while let Some(found) = strings::index_of_any(&text[at..], b"eirmjvsd") {
        at += found;
        let begins_word =
            at == 0 || !(text[at - 1].is_ascii_alphanumeric() || text[at - 1] == b'_');
        let word = WORDS.iter().find(|(word, _)| text[at..].starts_with(word));
        let Some(&(word, kind)) = word.filter(|_| begins_word) else {
            at += 1;
            continue;
        };
        at += word.len();
        if text.get(at).is_some_and(|&byte| is_identifier_byte(byte)) {
            continue;
        }
        if matches!(kind, Word::Declares | Word::DeclaresOrLoads)
            && read_import_declaration(text, at, visit).is_some()
        {
            continue;
        }
        let open = skip_space(text, at);
        if kind == Word::Deletes {
            const CACHE: &[u8] = b"require.cache[";
            const RESOLVE: &[u8] = b"require.resolve(";
            if text[open..].starts_with(CACHE) {
                let mut key = skip_space(text, open + CACHE.len());
                if text[key..].starts_with(RESOLVE) {
                    key = skip_space(text, key + RESOLVE.len());
                }
                let specifier = read_string(text, key, b"\"'`").map(|(specifier, _)| specifier);
                let specifier = specifier.filter(|it| !strings::contains_char(it, b'$'));
                visit(NamedByTest::Eviction { specifier });
            }
            continue;
        }
        if kind == Word::Declares || text.get(open) != Some(&b'(') {
            continue;
        }
        let argument = skip_space(text, open + 1);
        if kind == Word::Spies {
            let spy = read_identifier(text, argument).and_then(|(local, next)| {
                let comma = skip_space(text, next);
                if text.get(comma) != Some(&b',') {
                    return None;
                }
                let (name, _) = read_string(text, skip_space(text, comma + 1), b"\"'")?;
                Some(NamedByTest::Spy { local, name })
            });
            if let Some(spy) = spy {
                visit(spy);
            }
            continue;
        }
        let Some((specifier, end)) = read_string(text, argument, b"\"'`") else {
            continue;
        };
        if strings::contains_char(specifier, b'$') {
            continue;
        }
        let is_required = kind == Word::Requires;
        match kind {
            Word::Mocks => visit(NamedByTest::Mock { specifier }),
            _ if word == b"import" || word == b"require" => {
                read_load(text, (at - word.len(), end), specifier, is_required, visit);
            }
            // A path, which may go anywhere.
            _ => visit(NamedByTest::Namespace {
                specifier,
                local: None,
                is_required,
            }),
        }
    }
}

fn for_each_path_spelled<'a>(text: &'a [u8], mut visit: impl FnMut(&'a [u8])) {
    let mut at = 0;
    while let Some(found) = strings::index_of_any(&text[at..], b"\"'`") {
        at += found;
        let rest = &text[at + 1..];
        // Behind `from` stands a declaration, which is read for what it names, or names types alone.
        let is_declared = text[..at].trim_ascii_end().ends_with(b"from");
        let path = (!is_declared && (rest.starts_with(b"./") || rest.starts_with(b"../")))
            .then(|| read_string(text, at, b"\"'`"))
            .flatten();
        match path {
            Some((path, next)) => {
                visit(path);
                at = next;
            }
            None => at += 1,
        }
    }
}

// `new URL("./worker.ts", import.meta.url)`: the first argument.
fn for_each_path_beside_file(text: &[u8], mut visit: impl FnMut(&[u8])) {
    const START: &[u8] = b"new URL(";
    let mut at = 0;
    while let Some(found) = strings::index_of(&text[at..], START) {
        at += found + START.len();
        let Some((path, next)) = read_string(text, skip_space(text, at), b"\"'`") else {
            continue;
        };
        let comma = skip_space(text, next);
        if text.get(comma) == Some(&b',')
            && text[skip_space(text, comma + 1)..].starts_with(b"import.meta.url")
        {
            visit(path);
        }
    }
}

// The scans read words, not syntax: behind `module` in a comment stands "'s own ..", and minified code has a quote anywhere.
fn may_name_module(name: &[u8]) -> bool {
    !name.is_empty()
        && name.iter().all(|&byte| {
            byte.is_ascii_alphanumeric() || byte >= 0x80 || b"@/._-~#:+?=&%$[]()!".contains(&byte)
        })
}

// How much of a module the stand-in hands out. The larger wins.
#[derive(Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Shown {
    // The name finds no file that the build takes: the stand-in does not import it.
    #[default]
    Nothing,
    // `NamedOfModule::names`
    Names,
    Whole,
}

// What the test files name of one module.
#[derive(Default)]
struct NamedOfModule {
    names: Vec<Box<[u8]>>,
    spied_on: Vec<Box<[u8]>>,
    // "?again": what stands behind the path where a test loads the file under a query.
    queries_imported: Vec<Box<[u8]>>,
    queries_required: Vec<Box<[u8]>>,
    shown: Shown,
    is_mocked: bool,
    is_evicted: bool,
}

impl NamedOfModule {
    fn show(&mut self, shown: Shown) {
        self.shown = self.shown.max(shown);
    }
}

struct NamedByTests<'vm> {
    vm: &'vm mut VirtualMachine,
    // They run from disk, also where one of them imports another.
    test_files: bun_collections::StringSet,
    // By the path of the file, or by the name as it is written where the name finds no file or a module of Bun.
    modules: std::collections::BTreeMap<Vec<u8>, NamedOfModule>,
    // Files that Bun loads again, from disk.
    copied: Vec<Vec<u8>>,
    // The files with code in the folders that test files name by a URL.
    listed: Vec<Box<[u8]>>,
    evicts_under_unknown_key: bool,
    stands_in: StandsIn,
}

impl NamedByTests<'_> {
    fn is_module_of_bun(&self, name: &[u8]) -> bool {
        let target = self.vm.transpiler.resolver.opts.target;
        name.starts_with(b"node:")
            || name.starts_with(b"bun:")
            || bun_resolve_builtins::Alias::has(name, target, Default::default())
    }

    // A package may have one file for `import` and another for `require()`. Whoever names the package may get either.
    fn find(&mut self, folder: &[u8], specifier: &[u8]) -> Vec<(Vec<u8>, bool)> {
        const EXTENSIONS: [&[u8]; 9] = [
            b".ts", b".tsx", b".js", b".jsx", b".mjs", b".cjs", b".mts", b".cts", b".json",
        ];
        let mut found: Vec<(Vec<u8>, bool)> = Vec::new();
        if !may_name_module(specifier) {
            return found;
        }
        // Under the name as it is written: "node:tty", "tty".
        if self.is_module_of_bun(specifier) {
            return vec![(specifier.to_vec(), true)];
        }
        for kind in [bun_ast::ImportKind::Stmt, bun_ast::ImportKind::Require] {
            let Ok(result) = self.vm.transpiler.resolver.resolve(folder, specifier, kind) else {
                continue;
            };
            let path = result.path_pair.primary.text();
            if !bun_path::is_absolute(path) {
                return Vec::new();
            }
            if !found.iter().any(|(other, _)| other == path) {
                let is_imported = EXTENSIONS.iter().any(|extension| path.ends_with(extension));
                found.push((path.to_vec(), is_imported));
            }
        }
        if found.is_empty() {
            found.push(match specifier.starts_with(b".") {
                true => {
                    let path = resolve_path::join_abs_string::<bun_path::platform::Auto>(
                        folder,
                        &[specifier],
                    );
                    (path.to_vec(), false)
                }
                false => (specifier.to_vec(), false),
            });
        }
        found
    }

    // The files with code that the files of the image name by `new URL(.., import.meta.url)`: a Worker starts from such a file, and nothing needs to import it.
    fn note_files_named_by_urls(&mut self) {
        const EXTENSIONS: [&[u8]; 8] = [
            b".ts", b".tsx", b".js", b".jsx", b".mjs", b".cjs", b".mts", b".cts",
        ];
        let is_code = |path: &[u8]| EXTENSIONS.iter().any(|extension| path.ends_with(extension));
        let named = self
            .modules
            .iter()
            .filter(|it| it.1.shown != Shown::Nothing);
        let mut left: Vec<Vec<u8>> = named.map(|it| it.0.clone()).collect();
        left.retain(|path| is_code(path) && !strings::contains(path, b"/node_modules/"));
        let mut seen = bun_collections::StringSet::new();
        for path in &left {
            let _ = seen.insert(path);
        }
        // A statement of the first names the second.
        let mut statements: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
        let mut cannot_load: Vec<Vec<u8>> = Vec::new();
        while let Some(file) = left.pop() {
            let Some(text) = read_code(&file) else {
                continue;
            };
            let folder = resolve_path::dirname::<bun_path::platform::Auto>(&file);
            let mut named_by_statements: Vec<&[u8]> = Vec::new();
            for_each_name_in_statement(&text, |name| named_by_statements.push(name));
            for_each_imported_name(&text, |name| {
                if !may_name_module(name) {
                    return;
                }
                let is_in_statement = named_by_statements.contains(&name);
                let kind = bun_ast::ImportKind::Stmt;
                let Ok(result) = self.vm.transpiler.resolver.resolve(folder, name, kind) else {
                    let is_mocked = || self.modules.get(name).is_some_and(|it| it.is_mocked);
                    if is_in_statement && !self.is_module_of_bun(name) && !is_mocked() {
                        cannot_load.push(file.clone());
                    }
                    return;
                };
                let path = result.path_pair.primary.text();
                if is_in_statement && bun_path::is_absolute(path) {
                    statements.push((file.clone(), path.to_vec()));
                }
                // A package starts its Workers from its own files, and its text is often minified.
                if strings::contains(path, b"/node_modules/") {
                    return;
                }
                if bun_path::is_absolute(path) && is_code(path) && !seen.contains(path) {
                    let _ = seen.insert(path);
                    left.push(path.to_vec());
                    // A file of the image imports it, so it is in the image, and the test runner asks for it.
                    if self.test_files.contains(path) {
                        self.modules
                            .entry(path.to_vec())
                            .or_default()
                            .show(Shown::Names);
                    }
                }
            });
            for_each_path_beside_file(&text, |relative| {
                let path =
                    resolve_path::join_abs_string::<bun_path::platform::Auto>(folder, &[relative]);
                if !may_name_module(relative) || !is_code(path) || self.test_files.contains(path) {
                    return;
                }
                if !bun_sys::exists(path) {
                    return;
                }
                self.modules
                    .entry(path.to_vec())
                    .or_default()
                    .show(Shown::Names);
                if !seen.contains(path) {
                    let _ = seen.insert(path);
                    left.push(path.to_vec());
                }
            });
        }
        // The stand-in imports what the tests name by statements. With one file among them that cannot load it could not load itself, and what it says would count for
        // nothing. Such a file stays on disk: whoever loads it gets what the loader says.
        let mut at = 0;
        while at < cannot_load.len() {
            let importers = statements.iter().filter(|it| it.1 == cannot_load[at]);
            let importers: Vec<Vec<u8>> = importers.map(|it| it.0.clone()).collect();
            for importer in importers {
                if !cannot_load.contains(&importer) {
                    cannot_load.push(importer);
                }
            }
            at += 1;
        }
        for file in &cannot_load {
            if let Some(module) = self.modules.get_mut(file) {
                module.shown = Shown::Nothing;
            }
        }
    }

    // `is_test_file`: not a file that is loaded again. What such a file loads again in its turn is not followed.
    fn note_file(&mut self, file: &[u8], is_test_file: bool) {
        let Some(text) = read_code(file) else {
            return;
        };
        let folder = resolve_path::dirname::<bun_path::platform::Auto>(file);
        if is_test_file {
            // `new URL("./rows/", import.meta.url)`: a folder below the test file's own, to be listed. What the test file loads of it runs from disk as the
            // test file does. `new URL("../../", import.meta.url)` is where the project lies, and no list of what the test loads.
            for_each_path_beside_file(&text, |path| {
                let below = path
                    .strip_prefix(b"./")
                    .and_then(|it| it.strip_suffix(b"/"));
                if let Some(below) =
                    below.filter(|it| !it.is_empty() && !strings::contains(it, b".."))
                {
                    let root =
                        resolve_path::join_abs_string::<bun_path::platform::Auto>(folder, &[below]);
                    add_files_below(root, b"", b"", &mut self.listed);
                }
            });
        }
        let mut all: Vec<NamedByTest<'_>> = Vec::new();
        for_each_named_by_test(&text, &mut |named| all.push(named));
        let names_for_jsx = find_names_imported_for_jsx(self.vm, file);
        all.extend(names_for_jsx.iter().map(|name| NamedByTest::Namespace {
            specifier: name,
            local: None,
            is_required: false,
        }));
        if is_test_file {
            let specifier_of = |named: &NamedByTest<'_>| match *named {
                NamedByTest::Export { specifier, .. }
                | NamedByTest::Namespace { specifier, .. }
                | NamedByTest::File { specifier }
                | NamedByTest::Mock { specifier }
                | NamedByTest::Type { specifier }
                | NamedByTest::Eviction {
                    specifier: Some(specifier),
                } => Some(specifier.as_ptr()),
                _ => None,
            };
            let mut read_before: Vec<*const u8> = all.iter().filter_map(specifier_of).collect();
            read_before.sort_unstable();
            for_each_path_spelled(&text, |specifier| {
                if read_before.binary_search(&specifier.as_ptr()).is_err()
                    && !strings::contains_char(specifier, b'$')
                {
                    all.push(NamedByTest::Spelled { specifier });
                }
            });
        }
        let mut namespaces: Vec<(&[u8], Vec<u8>)> = Vec::new();
        for named in &all {
            let specifier = match *named {
                NamedByTest::Export { specifier, .. }
                | NamedByTest::Spelled { specifier }
                | NamedByTest::Namespace { specifier, .. }
                | NamedByTest::File { specifier }
                | NamedByTest::Mock { specifier }
                | NamedByTest::Eviction {
                    specifier: Some(specifier),
                } => specifier,
                NamedByTest::Eviction { specifier: None } => {
                    self.evicts_under_unknown_key |= is_test_file;
                    continue;
                }
                NamedByTest::Spy { .. } | NamedByTest::Type { .. } => continue,
            };
            // A path beside the file leads to a file of the project.
            if self.stands_in == StandsIn::ForAllAboveThePackages && specifier.starts_with(b".") {
                continue;
            }
            let start_of_query = strings::index_of_char_usize(specifier, b'?');
            let (path, query) = specifier.split_at(start_of_query.unwrap_or(specifier.len()));
            for (position, (key, is_imported)) in self.find(folder, path).into_iter().enumerate() {
                if self.test_files.contains(&key) {
                    continue;
                }
                // A file of the project that the walk from the test files has not met stands above the packages as the others do.
                if self.stands_in == StandsIn::ForAllAboveThePackages
                    && bun_path::is_absolute(&key)
                    && !strings::contains(&key, b"/node_modules/")
                {
                    continue;
                }
                if matches!(named, NamedByTest::Spelled { .. }) && !is_imported {
                    continue;
                }
                let is_copied = !query.is_empty() || matches!(named, NamedByTest::Eviction { .. });
                if is_copied && is_test_file && is_imported {
                    self.copied.push(key.clone());
                }
                if let NamedByTest::Namespace {
                    local: Some(local), ..
                } = *named
                {
                    namespaces.push((local, key.clone()));
                }
                let module = self.modules.entry(key).or_default();
                let (names, whole) = match is_imported {
                    true => (Shown::Names, Shown::Whole),
                    false => (Shown::Nothing, Shown::Nothing),
                };
                module.show(names);
                match *named {
                    NamedByTest::Eviction { .. } => module.is_evicted |= is_test_file,
                    NamedByTest::Mock { .. } => module.is_mocked = true,
                    NamedByTest::Namespace {
                        is_required: true, ..
                    } if !query.is_empty() => module.queries_required.push(Box::from(query)),
                    _ if !query.is_empty() => module.queries_imported.push(Box::from(query)),
                    // The file for `require()`, which answers with all of it.
                    _ if position > 0 => module.show(whole),
                    NamedByTest::Export { name, .. } => module.names.push(Box::from(name)),
                    NamedByTest::Namespace {
                        local: Some(local), ..
                    } => match find_names_read_off(&text, local) {
                        Some(names) => module.names.extend(names.into_iter().map(Box::from)),
                        None => module.show(whole),
                    },
                    NamedByTest::Namespace { .. } | NamedByTest::Spelled { .. } => {
                        module.show(whole)
                    }
                    NamedByTest::File { .. }
                    | NamedByTest::Spy { .. }
                    | NamedByTest::Type { .. } => {}
                }
            }
        }
        for named in &all {
            let NamedByTest::Spy { local, name } = *named else {
                continue;
            };
            let of_local = namespaces.iter().filter(|(other, _)| *other == local);
            for (_, key) in of_local {
                if let Some(module) = self.modules.get_mut(key) {
                    module.spied_on.push(Box::from(name));
                }
            }
        }
    }
}

fn find_what_tests_name<'vm>(
    vm: &'vm mut VirtualMachine,
    test_files: &[Interned],
    stands_in: StandsIn,
) -> NamedByTests<'vm> {
    let mut paths = bun_collections::StringSet::new();
    for path in test_files {
        let _ = paths.insert(&**path);
    }
    let mut named = NamedByTests {
        vm,
        test_files: paths,
        modules: Default::default(),
        copied: Vec::new(),
        listed: Vec::new(),
        evicts_under_unknown_key: false,
        stands_in,
    };
    // What the resolver says of a name that finds nothing is for whoever really loads it.
    let log = named.vm.transpiler.resolver.log_mut();
    let said_before = (log.msgs.len(), log.errors, log.warnings);
    for test_file in test_files {
        named.note_file(test_file, true);
    }
    // They name folders in their turn.
    while let Some(file) = named.listed.pop() {
        if !named.test_files.contains(&file) {
            let _ = named.test_files.insert(&file);
            named.note_file(&file, true);
        }
    }
    // The copy asks the image for what the file imports.
    let mut copied = core::mem::take(&mut named.copied);
    copied.sort_unstable();
    copied.dedup();
    for file in &copied {
        named.note_file(file, false);
    }
    if stands_in == StandsIn::ForTestFiles {
        named.note_files_named_by_urls();
    }
    let log = named.vm.transpiler.resolver.log_mut();
    log.msgs.truncate(said_before.0);
    (log.errors, log.warnings) = (said_before.1, said_before.2);
    for module in named.modules.values_mut() {
        for list in [
            &mut module.names,
            &mut module.spied_on,
            &mut module.queries_imported,
            &mut module.queries_required,
        ] {
            list.sort_unstable();
            list.dedup();
        }
    }
    named
}

// The files with code among them are entry points: the loader answers a file from disk with an entry point and with no other file of the image.
fn add_files_named(named: &NamedByTests<'_>, files: &mut Vec<Box<[u8]>>) {
    let mut seen = bun_collections::StringSet::new();
    for path in files.iter() {
        let _ = seen.insert(&**path);
    }
    for (path, module) in &named.modules {
        let is_file = module.shown != Shown::Nothing && bun_path::is_absolute(path);
        if is_file && !path.ends_with(b".json") && !seen.contains(path) {
            files.push(Box::from(&**path));
        }
    }
}

fn has_file_with_window<'a>(
    mut test_files: impl Iterator<Item = &'a [u8]>,
    environment_of_project: Option<TestEnvironment>,
) -> bool {
    environment_of_project.is_some_and(|kind| kind != TestEnvironment::Node)
        || test_files.any(|path| Environment::of_file(path, None).has_window())
}

fn make_stand_in_for_window() -> Box<[u8]> {
    let text = b"const name = process.argv.at(-1)!;
if (name === \"\\0never\") (globalThis as any)[name] = require(name);
";
    let path = resolve_path::join_abs_string::<bun_path::platform::Auto>(
        FileSystem::get().top_level_dir(),
        &[b"node_modules/.cache/bun-test-window.ts"],
    )
    .to_vec();
    run_compiled::set_stand_in(&path, text);
    path.into_boxed_slice()
}

fn append_quoted(text: &mut Vec<u8>, string: &[u8]) {
    text.push(b'"');
    for &byte in string {
        if matches!(byte, b'"' | b'\\') {
            text.push(b'\\');
        }
        text.push(byte);
    }
    text.push(b'"');
}

// For whom a stand-in speaks: the files that use a program and that its build does not see.
#[derive(Clone, Copy, PartialEq, Eq)]
enum StandsIn {
    ForTestFiles,
    // The layer of the packages is used by the files of the project, the test files among them.
    ForAllAboveThePackages,
}

// BUN_AOT_TESTS_NAME_WHAT_THEY_USE. The build does not see the test files. This file stands in for what they do with the files of the image, and names what they name: an export that a test imports goes to a callee nobody
// knows, and so does the namespace of a module that a test takes whole; `spyOn()` and `mock.module()` are written out. It loads nothing under a name that nothing says. The condition is one that flow
// cannot fold.
fn make_stand_in_that_names_what_tests_name(
    vm: &mut VirtualMachine,
    test_files: &[Interned],
    stands_in: StandsIn,
    entry_points: &mut Vec<Box<[u8]>>,
) -> Box<[u8]> {
    let named = find_what_tests_name(vm, test_files, stands_in);
    add_files_named(&named, entry_points);
    let modules = &named.modules;
    let mut text: Vec<u8> = b"import { mock, spyOn } from \"bun:test\";\n".to_vec();
    let imported = || modules.iter().enumerate();
    // Files from disk reach every module of Bun by themselves. What the build has to hear of one is which of its exports they spy on.
    let is_file = |key: &[u8]| bun_path::is_absolute(key);
    // What `require()` answers for a file of data depends on whether a module that imports it by a statement has been loaded.
    let is_data = |key: &[u8]| key.ends_with(b".json");
    for (index, (key, module)) in imported() {
        let is_named = is_file(key) && !is_data(key);
        if module.shown != Shown::Nothing && (is_named || !module.spied_on.is_empty()) {
            text.extend_from_slice(format!("import * as n{index} from ").as_bytes());
            append_quoted(&mut text, key);
            text.extend_from_slice(b";\n");
        }
    }
    text.extend_from_slice(
        b"const other = process.argv.at(-1);
if (other === \"\\0never\") {
  const sink = globalThis[other];
",
    );
    for (index, (key, module)) in imported() {
        if module.shown != Shown::Nothing && is_data(key) {
            for (load, end) in [
                (&b"  sink(await import("[..], &b"));\n"[..]),
                (b"  sink(require(", b"));\n"),
            ] {
                text.extend_from_slice(load);
                append_quoted(&mut text, key);
                text.extend_from_slice(end);
            }
        } else if module.shown == Shown::Whole && is_file(key) {
            text.extend_from_slice(format!("  sink(n{index});\n").as_bytes());
        } else if module.shown == Shown::Names && is_file(key) && !module.names.is_empty() {
            text.extend_from_slice(b"  sink(");
            for (position, name) in module.names.iter().enumerate() {
                if position > 0 {
                    text.extend_from_slice(b", ");
                }
                text.extend_from_slice(format!("n{index}").as_bytes());
                let is_identifier =
                    !name[0].is_ascii_digit() && name.iter().all(|&byte| is_identifier_byte(byte));
                if is_identifier {
                    text.push(b'.');
                    text.extend_from_slice(name);
                } else {
                    text.push(b'[');
                    append_quoted(&mut text, name);
                    text.push(b']');
                }
            }
            text.extend_from_slice(b");\n");
        }
        for name in module
            .spied_on
            .iter()
            .filter(|_| module.shown != Shown::Nothing)
        {
            text.extend_from_slice(format!("  spyOn(n{index}, ").as_bytes());
            append_quoted(&mut text, name);
            text.extend_from_slice(b");\n");
        }
        if module.is_mocked {
            text.extend_from_slice(b"  mock.module(");
            append_quoted(&mut text, key);
            text.extend_from_slice(b", () => ({}));\n");
        }
        if module.is_evicted {
            text.extend_from_slice(b"  delete require.cache[require.resolve(");
            append_quoted(&mut text, key);
            text.extend_from_slice(b")];\n");
        }
        let loads: [(&[u8], &[Box<[u8]>]); 2] = [
            (b"  await import(", &module.queries_imported),
            (b"  require(", &module.queries_required),
        ];
        for (load, queries) in loads {
            for query in queries {
                text.extend_from_slice(load);
                append_quoted(&mut text, &[&**key, &**query].concat());
                text.extend_from_slice(b");\n");
            }
        }
    }
    if named.evicts_under_unknown_key {
        text.extend_from_slice(b"  delete require.cache[other];\n");
    }
    // Only the lowest image holds modules of Bun's own code, and one that it does not hold would run in the interpreter. See `make_stand_in_for_files_from_disk`.
    if stands_in == StandsIn::ForAllAboveThePackages {
        for specifier in bun_aot::builtins::library_modules_that_programs_load() {
            text.extend_from_slice(b"  require(\"");
            text.extend_from_slice(specifier);
            text.extend_from_slice(b"\");\n");
        }
        for builtin in bun_aot::builtins::builtins_that_load_library_modules() {
            if strings::contains_char(builtin.as_bytes(), b'.') {
                text.extend_from_slice(b"  void ");
                text.extend_from_slice(builtin.as_bytes());
                text.extend_from_slice(b";\n");
            }
        }
    }
    text.extend_from_slice(b"}\n");
    // The name of the module. No file is there.
    let name: &[u8] = match stands_in {
        StandsIn::ForTestFiles => b"node_modules/.cache/bun-test-files-from-disk.js",
        StandsIn::ForAllAboveThePackages => b"node_modules/.cache/bun-test-files-above-packages.js",
    };
    let path = resolve_path::join_abs_string::<bun_path::platform::Auto>(
        FileSystem::get().top_level_dir(),
        &[name],
    )
    .to_vec();
    run_compiled::set_stand_in(&path, &text);
    path.into_boxed_slice()
}

// ─── compat shim: map legacy paths onto the test_runner crate ────────────────
// The body was originally written against `bun_jsc::jest::{bun_test, Snapshots,
// TestRunner}` before `crate::test_runner` existed. Those types now live under
// `crate::test_runner::*`; the façade below adapts the body's nested-path
// usage (`bun_test::Execution::Result`, `bun_test::BasicResult`, …) without a
// 2k-line body rewrite.
use crate::test_runner::environment::Environment;
use crate::test_runner::jest::{self, FileColumns as _, Summary, TestRunner};
use crate::test_runner::snapshot::Snapshots;
use bun_collections::index_sort;

mod bun_test {
    //! Façade over `crate::test_runner` that preserves the legacy paths
    //! the body uses (`bun_test::Execution::Result`, `bun_test::BasicResult`,
    //! `bun_test::DescribeScope`, …). Drop once the body is normalised.

    /// `add_result()` queue payload.
    pub(super) use crate::test_runner::bun_test::RefDataValue as ResultMsg;
    pub(super) use crate::test_runner::bun_test::*;
    pub(super) use crate::test_runner::execution::{
        Basic as BasicResult, ExpectAssertions, PendingIs as PendingMode,
    };
    #[allow(non_snake_case)]
    pub(super) mod Execution {
        pub(crate) use crate::test_runner::execution::*;
    }
}

pub(crate) fn escape_xml(str_: &[u8], writer: &mut impl bun_io::Write) -> crate::Result<()> {
    let mut last: usize = 0;
    let mut i: usize = 0;
    let len = str_.len();
    while i < len {
        let c = str_[i];
        match c {
            b'&' | b'<' | b'>' | b'"' | b'\'' => {
                if i > last {
                    writer.write_all(&str_[last..i])?;
                }
                writer.write_all(bun_core::strings::xml_escape_entity(c).unwrap())?;
                last = i + 1;
            }
            b'\t' | b'\n' | b'\r' => {
                // Valid XML 1.0 Char. Emit as a numeric reference so the literal
                // byte survives attribute-value normalisation (XML 1.0 §3.3.3).
                if i > last {
                    writer.write_all(&str_[last..i])?;
                }
                write!(writer, "&#{};", c)?;
                last = i + 1;
            }
            0..=0x1f => {
                // Any other C0 control character is not a valid XML 1.0 Char and
                // cannot be represented even as a numeric reference, so drop it.
                if i > last {
                    writer.write_all(&str_[last..i])?;
                }
                last = i + 1;
            }
            0xEF if matches!(str_[i..], [_, 0xBF, 0xBE | 0xBF, ..]) => {
                // U+FFFE and U+FFFF aren't valid XML 1.0 Chars either.
                if i > last {
                    writer.write_all(&str_[last..i])?;
                }
                i += 2;
                last = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    if len > last {
        writer.write_all(&str_[last..])?;
    }
    Ok(())
}

fn fmt_status_text_line(
    status: bun_test::Execution::Result,
    emoji_or_color: bool,
) -> Output::PrettyBuf {
    // emoji and color might be split into two different options in the future
    // some terminals support color, but not emoji.
    // For now, they are the same.
    match emoji_or_color {
        true => match status.basic_result() {
            bun_test::BasicResult::Pending => Output::pretty_fmt::<true>("<r><d>…<r>"),
            bun_test::BasicResult::Pass => Output::pretty_fmt::<true>("<r><green>✓<r>"),
            bun_test::BasicResult::Fail => Output::pretty_fmt::<true>("<r><red>✗<r>"),
            bun_test::BasicResult::Skip => Output::pretty_fmt::<true>("<r><yellow>»<d>"),
            bun_test::BasicResult::Todo => Output::pretty_fmt::<true>("<r><magenta>✎<r>"),
        },
        false => match status.basic_result() {
            bun_test::BasicResult::Pending => Output::pretty_fmt::<false>("<r><d>(pending)<r>"),
            bun_test::BasicResult::Pass => Output::pretty_fmt::<false>("<r><green>(pass)<r>"),
            bun_test::BasicResult::Fail => Output::pretty_fmt::<false>("<r><red>(fail)<r>"),
            bun_test::BasicResult::Skip => Output::pretty_fmt::<false>("<r><yellow>(skip)<d>"),
            bun_test::BasicResult::Todo => Output::pretty_fmt::<false>("<r><magenta>(todo)<r>"),
        },
    }
}

// `Output::error_writer()` / `Output::writer()` already return an unbounded
// `&mut io::Writer`; the previous local `err_w`/`out_w` wrappers were no-op
// reborrows. Call sites use the `Output` accessors directly.

/// Name, message and stack of the error(s) thrown by the test that is
/// currently failing, captured as they are printed so structured reporters
/// get them without re-running the exception formatter.
#[derive(Default)]
pub(crate) struct TestFailure {
    pub name: Vec<u8>,
    pub(crate) message: Vec<u8>,
    pub(crate) body: Vec<u8>,
    /// An uncaught exception or unhandled rejection while the test was running, not an error from the test function's own call.
    pub(crate) uncaught: bool,
}

/// How a test file is named in the JUnit document: relative to the project
/// root when inside it, else as given.
pub(crate) fn junit_file_name(path: &[u8]) -> &[u8] {
    let top = FileSystem::get().top_level_dir();
    if strings::has_prefix(path, top) {
        without_leading_path_separator(&path[top.len()..])
    } else {
        path
    }
}

/// One finished test as structured reporters see it.
pub(crate) struct TestCaseReport<'a> {
    /// Relative to the project root.
    pub file: &'a [u8],
    /// Enclosing named `describe` blocks, outermost first: (name, line).
    pub scopes: Vec<(&'a [u8], u32)>,
    pub name: &'a [u8],
    pub status: bun_test::Execution::Result,
    pub assertions: u32,
    pub elapsed_ns: u64,
    pub line_number: u32,
    pub failure: Option<TestFailure>,
    /// Failures from earlier attempts of a retried test, oldest first.
    pub earlier_failures: Vec<TestFailure>,
}

/// Append `input` to `out`, dropping CSI sequences (`ESC '[' ... final`), so a
/// matcher message built with colour does not reach the report as SGR residue.
fn push_stripping_ansi(out: &mut Vec<u8>, input: &[u8]) {
    let mut i = 0;
    while i < input.len() {
        if input[i] == 0x1b && i + 1 < input.len() && input[i + 1] == b'[' {
            i += 2;
            while i < input.len() && !(0x40..=0x7e).contains(&input[i]) {
                i += 1;
            }
            if i < input.len() {
                i += 1;
            }
            continue;
        }
        out.push(input[i]);
        i += 1;
    }
}

/// Writes a Unix time in milliseconds the way `Date.prototype.toISOString` does.
fn write_iso_8601(out: &mut Vec<u8>, unix_ms: i64) {
    let days = unix_ms.div_euclid(86_400_000);
    let ms = unix_ms.rem_euclid(86_400_000);
    // Days to a civil date: https://howardhinnant.github.io/date_algorithms.html#civil_from_days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    let _ = write!(
        out,
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year,
        month,
        day,
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60,
        ms % 1000,
    );
}

// Remaining TODOs:
// - Add stdout/stderr to the JUnit report
#[derive(Default)]
pub(crate) struct JunitReporter {
    pub(crate) contents: Vec<u8>,
    pub(crate) total_metrics: Metrics,
    pub(crate) offset_of_testsuites_value: usize,
    pub(crate) current_file: Box<[u8]>,
    pub(crate) file_start_ns: u64,
    /// Unix time in milliseconds. The `timestamp` of every suite in the file.
    pub(crate) file_start_unix_ms: i64,
    pub(crate) properties_list_to_repeat_in_every_test_suite: Option<Box<[u8]>>,

    pub(crate) suite_stack: Vec<SuiteInfo>,
    pub(crate) current_depth: u32,
    pub(crate) suites: JunitSuites,

    pub(crate) hostname_value: Option<Box<[u8]>>,
}

#[derive(Default)]
pub(crate) struct SuiteInfo {
    pub name: Box<[u8]>,
    pub(crate) offset_of_attributes: usize,
    pub(crate) metrics: Metrics,
    pub(crate) is_file_suite: bool,
    pub(crate) started_ns: u64,
}

// We dupe the name unconditionally in begin_test_suite_with_line, so the
// unconditional drop is correct.

#[derive(Default, Clone, Copy)]
pub(crate) struct Metrics {
    pub(crate) test_cases: u32,
    pub(crate) assertions: u32,
    pub(crate) failures: u32,
    pub(crate) skipped: u32,
    pub(crate) elapsed_time: u64,
}

impl Metrics {
    fn add(&mut self, other: &Metrics) {
        self.test_cases += other.test_cases;
        self.assertions += other.assertions;
        self.failures += other.failures;
        self.skipped += other.skipped;
    }
}

impl JunitReporter {
    pub(crate) fn get_hostname(&mut self) -> Option<&[u8]> {
        if self.hostname_value.is_none() {
            #[cfg(windows)]
            {
                return None;
            }

            #[cfg(not(windows))]
            {
                const HOST_NAME_MAX: usize = 256;
                let mut name_buffer = [0u8; HOST_NAME_MAX];
                if bun_sys::posix::gethostname(&mut name_buffer).is_err() {
                    self.hostname_value = Some(Box::default());
                    return None;
                }
                let hostname = bun_core::slice_to_nul(&name_buffer);

                let mut arraylist_writer: Vec<u8> = Vec::new();
                if escape_xml(hostname, &mut arraylist_writer).is_err() {
                    self.hostname_value = Some(Box::default());
                    return None;
                }
                self.hostname_value = Some(arraylist_writer.into_boxed_slice());
            }
        }

        if let Some(hostname) = &self.hostname_value {
            if !hostname.is_empty() {
                return Some(hostname);
            }
        }
        None
    }

    pub(crate) fn init(suites: JunitSuites) -> Box<JunitReporter> {
        Box::new(JunitReporter {
            suites,
            ..Default::default()
        })
    }
}

impl TestFailure {
    /// Returns the failure to report for a result that has no thrown error, like a timeout.
    pub(crate) fn from_result(
        result: bun_test::Execution::Result,
        assertions: u32,
    ) -> Option<TestFailure> {
        use bun_test::Execution::Result as R;
        let message: Vec<u8> = match result {
            _ if result.is_timeout() => b"test timed out".to_vec(),
            R::FailBecauseFailingTestPassed => {
                b"test marked with .failing() did not throw".to_vec()
            }
            R::FailBecauseFailsTestPassed => b"test marked with .fails() did not fail".to_vec(),
            R::FailBecauseExpectedAssertionCount => {
                format!("Expected more assertions, but only received {assertions}").into_bytes()
            }
            R::FailBecauseTodoPassed => b"TODO passed".to_vec(),
            R::FailBecauseExpectedHasAssertions => {
                b"Expected to have assertions, but none were run".to_vec()
            }
            _ => return None,
        };
        Some(TestFailure {
            name: if result.is_timeout() {
                b"TimeoutError".to_vec()
            } else {
                b"AssertionError".to_vec()
            },
            message,
            ..Default::default()
        })
    }

    /// Fold in a `ZigException` that `print_error_instance_body` has already
    /// populated. A test can throw more than once (body, then `afterEach`);
    /// the first name/message win and every stack is appended.
    pub(crate) fn record(slot: &mut Option<TestFailure>, exception: &jsc::ZigException<'_>) {
        let failure = slot.get_or_insert_default();
        let name = exception.name.to_utf8();
        let raw_message = exception.message.to_utf8();
        let mut message = Vec::with_capacity(raw_message.slice().len());
        push_stripping_ansi(&mut message, raw_message.slice());

        let is_assertion = strings::has_prefix_comptime(&message, b"expect(")
            && (name.slice().is_empty() || strings::eql(name.slice(), b"Error"));

        if failure.name.is_empty() {
            if is_assertion {
                failure.name.extend_from_slice(b"AssertionError");
            } else {
                failure.name.extend_from_slice(name.slice());
            }
        }
        if failure.message.is_empty() {
            failure.message.extend_from_slice(&message);
        }

        let body = &mut failure.body;
        if !body.is_empty() {
            body.push(b'\n');
        }
        let header: &[u8] = if is_assertion {
            b"AssertionError"
        } else {
            name.slice()
        };
        match (header.is_empty(), message.is_empty()) {
            (true, true) => body.extend_from_slice(b"error"),
            (true, false) => body.extend_from_slice(&message),
            (false, true) => body.extend_from_slice(header),
            (false, false) => {
                body.extend_from_slice(header);
                body.extend_from_slice(b": ");
                body.extend_from_slice(&message);
            }
        }
        body.push(b'\n');
        let dir = FileSystem::get().top_level_dir();
        for frame in exception.stack.frames() {
            let source_url = frame.source_url.to_utf8();
            let file = jsc::ZigStackFrame::relative_source_url(dir, source_url.slice());
            let func = frame.function_name.to_utf8();
            if file.is_empty() && func.slice().is_empty() {
                continue;
            }
            body.extend_from_slice(b"      at ");
            if !func.slice().is_empty() {
                let _ = write!(body, "{} (", frame.name_formatter(false));
            }
            let file_start = body.len();
            body.extend_from_slice(file);
            if cfg!(windows) {
                for b in &mut body[file_start..] {
                    if *b == b'\\' {
                        *b = b'/';
                    }
                }
            }
            let pos = frame.position;
            if pos.line.is_valid() && pos.column.is_valid() {
                let _ = write!(body, ":{}:{}", pos.line.one_based(), pos.column.one_based());
            } else if pos.line.is_valid() {
                let _ = write!(body, ":{}", pos.line.one_based());
            }
            if !func.slice().is_empty() {
                body.push(b')');
            }
            body.push(b'\n');
        }
    }

    /// A module that can't be found or parsed throws one of these two. They are printed as log messages, with no `ZigException`.
    #[optimize(size)]
    pub(crate) fn record_log_message(slot: &mut Option<TestFailure>, thrown: jsc::JSValue) {
        let (name, msg): (&[u8], _) =
            if let Some(error) = thrown.as_class_ref::<jsc::ResolveMessage>() {
                (b"ResolveMessage", &error.msg)
            } else if let Some(error) = thrown.as_class_ref::<jsc::BuildMessage>() {
                (b"BuildMessage", &error.msg)
            } else {
                return;
            };
        let failure = slot.get_or_insert_default();
        if failure.name.is_empty() {
            failure.name.extend_from_slice(name);
        }
        if failure.message.is_empty() {
            failure.message.extend_from_slice(&msg.data.text);
        }
        if !failure.body.is_empty() {
            failure.body.push(b'\n');
        }
        let _ = msg.write_format::<false>(&mut bun_io::AsFmt::new(&mut failure.body));
        failure.body.push(b'\n');
    }

    /// VirtualMachine::on_print_error_zig_exception thunk.
    #[optimize(size)]
    pub(crate) fn record_cb(ctx: *mut core::ffi::c_void, exception: &jsc::ZigException<'_>) {
        // SAFETY: `ctx` was set to an `&mut Option<TestFailure>` by
        // `on_uncaught_exception` for the duration of a single
        // `run_error_handler` call; single-threaded, no other borrow live.
        let slot = unsafe { &mut *ctx.cast::<Option<TestFailure>>() };
        TestFailure::record(slot, exception);
    }
}

impl JunitReporter {
    fn generate_properties_list(&mut self) -> crate::Result<()> {
        struct PropertiesList<'a> {
            ci: &'a [u8],
            commit: &'a [u8],
        }

        let ci_buf: Vec<u8>;
        let ci: &[u8] = 'brk: {
            if let Some(github_run_id) = env_var::GITHUB_RUN_ID.get() {
                if let Some(github_server_url) = env_var::GITHUB_SERVER_URL.get() {
                    if let Some(github_repository) = env_var::GITHUB_REPOSITORY.get() {
                        if !github_run_id.is_empty()
                            && !github_server_url.is_empty()
                            && !github_repository.is_empty()
                        {
                            let mut v = Vec::new();
                            // Std::io::Write removed; bun_io::Write (top-level) provides write_fmt.
                            let _ = write!(
                                &mut v,
                                "{}/{}/actions/runs/{}",
                                bstr::BStr::new(github_server_url),
                                bstr::BStr::new(github_repository),
                                bstr::BStr::new(github_run_id)
                            );
                            ci_buf = v;
                            break 'brk &ci_buf[..];
                        }
                    }
                }
            }

            if let Some(ci_job_url) = env_var::CI_JOB_URL.get() {
                if !ci_job_url.is_empty() {
                    break 'brk ci_job_url;
                }
            }

            break 'brk b"";
        };

        let commit: &[u8] = 'brk: {
            if let Some(github_sha) = env_var::GITHUB_SHA.get() {
                if !github_sha.is_empty() {
                    break 'brk github_sha;
                }
            }

            if let Some(sha) = env_var::CI_COMMIT_SHA.get() {
                if !sha.is_empty() {
                    break 'brk sha;
                }
            }

            if let Some(git_sha) = env_var::GIT_SHA.get() {
                if !git_sha.is_empty() {
                    break 'brk git_sha;
                }
            }

            break 'brk b"";
        };

        let properties = PropertiesList { ci, commit };

        if properties.ci.is_empty() && properties.commit.is_empty() {
            self.properties_list_to_repeat_in_every_test_suite = Some(Box::default());
            return Ok(());
        }

        let mut buffer: Vec<u8> = Vec::new();
        let writer = &mut buffer;

        writer.write_all(b"    <properties>\n")?;

        if !properties.ci.is_empty() {
            writer.write_all(b"      <property name=\"ci\" value=\"")?;
            escape_xml(properties.ci, writer)?;
            writer.write_all(b"\" />\n")?;
        }
        if !properties.commit.is_empty() {
            writer.write_all(b"      <property name=\"commit\" value=\"")?;
            escape_xml(properties.commit, writer)?;
            writer.write_all(b"\" />\n")?;
        }

        writer.write_all(b"    </properties>\n")?;

        self.properties_list_to_repeat_in_every_test_suite = Some(buffer.into_boxed_slice());
        Ok(())
    }

    fn get_indent(depth: u32) -> &'static [u8] {
        const SPACES: &[u8] =
            b"                                                                                ";
        const INDENT_SIZE: u32 = 2;
        let total_spaces = (depth + 1) * INDENT_SIZE;
        &SPACES[0..(total_spaces as usize).min(SPACES.len())]
    }

    fn start_document(&mut self) {
        if self.contents.is_empty() {
            self.contents
                .extend_from_slice(b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
            self.contents
                .extend_from_slice(b"<testsuites name=\"bun test\" ");
            self.offset_of_testsuites_value = self.contents.len();
            self.contents.extend_from_slice(b">\n");
        }
    }

    pub(crate) fn begin_test_suite(&mut self, name: &[u8]) -> crate::Result<()> {
        self.begin_test_suite_with_line(name, 0, true)
    }

    #[optimize(size)]
    pub(crate) fn begin_test_suite_with_line(
        &mut self,
        name: &[u8],
        line_number: u32,
        is_file_suite: bool,
    ) -> crate::Result<()> {
        self.start_document();

        let indent = Self::get_indent(self.current_depth);
        self.contents.extend_from_slice(indent);
        self.contents.extend_from_slice(b"<testsuite name=\"");
        escape_xml(name, &mut self.contents)?;
        self.contents.extend_from_slice(b"\"");

        if is_file_suite {
            self.contents.extend_from_slice(b" file=\"");
            escape_xml(name, &mut self.contents)?;
            self.contents.extend_from_slice(b"\"");
        } else if !self.current_file.is_empty() {
            self.contents.extend_from_slice(b" file=\"");
            // Reshaped for borrowck — clone current_file slice before mutable borrow of contents
            let cf = self.current_file.clone();
            escape_xml(&cf, &mut self.contents)?;
            self.contents.extend_from_slice(b"\"");
        }

        if line_number > 0 {
            // Std::io::Write removed; bun_io::Write (top-level) provides write_fmt.
            let _ = write!(&mut self.contents, " line=\"{}\"", line_number);
        }

        self.contents.extend_from_slice(b" ");
        let offset_of_attributes = self.contents.len();
        self.contents.extend_from_slice(b">\n");

        if is_file_suite {
            if self.properties_list_to_repeat_in_every_test_suite.is_none() {
                self.generate_properties_list()?;
            }

            if let Some(properties_list) = &self.properties_list_to_repeat_in_every_test_suite {
                if !properties_list.is_empty() {
                    self.contents.extend_from_slice(properties_list);
                }
            }
        }

        self.suite_stack.push(SuiteInfo {
            name: Box::<[u8]>::from(name),
            offset_of_attributes,
            metrics: Metrics::default(),
            is_file_suite,
            started_ns: if is_file_suite { self.file_start_ns } else { 0 },
        });

        self.current_depth += 1;
        if is_file_suite {
            self.current_file = Box::<[u8]>::from(name);
        }
        Ok(())
    }

    /// Close every suite still open for the current file. The file suite's
    /// `time` is `elapsed_ns` when the caller measured it (the `--parallel`
    /// coordinator replaying a worker's file), else now − `file_start_ns`.
    /// A `file` with no test cases gets an empty suite, so the report lists every file that ran.
    pub(crate) fn end_file(
        &mut self,
        file: Option<&[u8]>,
        elapsed_ns: Option<u64>,
    ) -> crate::Result<()> {
        if let Some(file) = file
            && !strings::eql(&self.current_file, file)
        {
            self.end_file(None, None)?;
            self.begin_test_suite(file)?;
        }
        while !self.suite_stack.is_empty() {
            self.end_test_suite(elapsed_ns)?;
        }
        self.current_file = Box::default();
        Ok(())
    }

    #[optimize(size)]
    fn end_test_suite(&mut self, file_elapsed_ns: Option<u64>) -> crate::Result<()> {
        if self.suite_stack.is_empty() {
            return Ok(());
        }

        self.current_depth -= 1;
        let suite_info = self.suite_stack.swap_remove(self.suite_stack.len() - 1);

        let elapsed_time_seconds = if suite_info.is_file_suite
            && let Some(ns) = file_elapsed_ns
        {
            ns as f64 / bun::time::NS_PER_S as f64
        } else if suite_info.is_file_suite && suite_info.started_ns > 0 {
            bun::Timespec::now(bun::TimespecMockMode::ForceRealTime)
                .ns()
                .saturating_sub(suite_info.started_ns) as f64
                / bun::time::NS_PER_S as f64
        } else {
            suite_info.metrics.elapsed_time as f64 / bun::time::MS_PER_S as f64
        };

        // Reshaped for borrowck — get hostname first
        let hostname = self.get_hostname().map(|h| h.to_vec()).unwrap_or_default();

        // Insert the summary attributes
        let mut summary = Vec::new();
        {
            // Std::io::Write removed; bun_io::Write (top-level) provides write_fmt.
            let _ = write!(
                &mut summary,
                "tests=\"{}\" assertions=\"{}\" failures=\"{}\" skipped=\"{}\" time=\"{}\" hostname=\"{}\" timestamp=\"",
                suite_info.metrics.test_cases,
                suite_info.metrics.assertions,
                suite_info.metrics.failures,
                suite_info.metrics.skipped,
                elapsed_time_seconds,
                bstr::BStr::new(&hostname),
            );
            write_iso_8601(&mut summary, self.file_start_unix_ms);
            summary.push(b'"');
        }

        self.contents.splice(
            suite_info.offset_of_attributes..suite_info.offset_of_attributes,
            summary.iter().copied(),
        );

        let indent = Self::get_indent(self.current_depth);
        self.contents.extend_from_slice(indent);
        self.contents.extend_from_slice(b"</testsuite>\n");

        if !self.suite_stack.is_empty() {
            let last = self.suite_stack.len() - 1;
            self.suite_stack[last].metrics.add(&suite_info.metrics);
        } else {
            self.total_metrics.add(&suite_info.metrics);
        }
        Ok(())
    }

    /// Open/close `<testsuite>` elements so the stack matches `t.file` and
    /// `t.scopes`, then write the `<testcase>`.
    #[optimize(size)]
    pub(crate) fn record_test_case(&mut self, t: &TestCaseReport<'_>) -> crate::Result<()> {
        if !strings::eql(&self.current_file, t.file) {
            while let Some(top) = self.suite_stack.last()
                && !top.is_file_suite
            {
                self.end_test_suite(None)?;
            }
            if !self.current_file.is_empty() {
                self.end_test_suite(None)?;
            }
            self.begin_test_suite(t.file)?;
        }

        if self.suites == JunitSuites::Flat {
            let mut name: Vec<u8> = Vec::new();
            for &(scope, _) in &t.scopes {
                name.extend_from_slice(scope);
                name.extend_from_slice(b" > ");
            }
            name.extend_from_slice(t.name);
            return self.write_test_case(t, &name, t.file);
        }

        // Only the flat form includes describe blocks with an empty title, like Vitest.
        let mut scopes = t.scopes.clone();
        scopes.retain(|(name, _)| !name.is_empty());

        // Keep the longest prefix of open describe suites that matches
        // `scopes`; close the rest, then open what is missing.
        let open = &self.suite_stack[1..];
        let keep = open
            .iter()
            .zip(&scopes)
            .take_while(|(suite, (name, _))| strings::eql(&suite.name, name))
            .count();
        for _ in keep..open.len() {
            self.end_test_suite(None)?;
        }
        for &(name, line) in &scopes[keep..] {
            self.begin_test_suite_with_line(name, line, false)?;
        }

        // Innermost scope first, matching what the serial reporter always did.
        let mut class_name: Vec<u8> = Vec::new();
        for (i, &(name, _)) in scopes.iter().rev().enumerate() {
            if i > 0 {
                class_name.extend_from_slice(b" > ");
            }
            class_name.extend_from_slice(name);
        }

        self.write_test_case(t, t.name, &class_name)
    }

    /// Writes `<failure>`, or Surefire's `<flakyFailure>` / `<rerunFailure>` for a retried test.
    #[optimize(size)]
    fn write_failure(
        &mut self,
        indent: &[u8],
        element: &[u8],
        failure: Option<&TestFailure>,
    ) -> crate::Result<()> {
        let type_name: &[u8] = failure
            .map(|f| f.name.as_slice())
            .filter(|n| !n.is_empty())
            .unwrap_or(b"Error");
        self.contents.extend_from_slice(indent);
        self.contents.extend_from_slice(b"  <");
        self.contents.extend_from_slice(element);
        self.contents.extend_from_slice(b" type=\"");
        escape_xml(type_name, &mut self.contents)?;
        self.contents.extend_from_slice(b"\"");
        if let Some(f) = failure.filter(|f| !f.message.is_empty()) {
            self.contents.extend_from_slice(b" message=\"");
            escape_xml(&f.message, &mut self.contents)?;
            self.contents.extend_from_slice(b"\"");
        }
        if failure.is_some_and(|f| f.uncaught) {
            self.contents.extend_from_slice(b" uncaught=\"true\"");
        }
        match failure.filter(|f| !f.body.is_empty()) {
            Some(f) => {
                self.contents.extend_from_slice(b">");
                escape_xml(&f.body, &mut self.contents)?;
                self.contents.extend_from_slice(b"</");
                self.contents.extend_from_slice(element);
                self.contents.extend_from_slice(b">\n");
            }
            None => {
                self.contents.extend_from_slice(b" />\n");
            }
        }
        Ok(())
    }

    #[optimize(size)]
    fn write_test_case(
        &mut self,
        t: &TestCaseReport<'_>,
        name: &[u8],
        class_name: &[u8],
    ) -> crate::Result<()> {
        let TestCaseReport {
            file,
            status,
            assertions,
            elapsed_ns,
            line_number,
            ..
        } = *t;
        let failure = t.failure.as_ref();
        // Std::io::Write removed; bun_io::Write (top-level) provides write_fmt.
        let elapsed_ns_f64: f64 = elapsed_ns as f64;
        let elapsed_ms = elapsed_ns_f64 / bun::time::NS_PER_MS as f64;

        if !self.suite_stack.is_empty() {
            let last = self.suite_stack.len() - 1;
            let current_suite = &mut self.suite_stack[last];
            current_suite.metrics.elapsed_time = current_suite
                .metrics
                .elapsed_time
                .saturating_add(elapsed_ms as u64);
            current_suite.metrics.test_cases += 1;
            current_suite.metrics.assertions += assertions;
        }

        let indent = Self::get_indent(self.current_depth);
        self.contents.extend_from_slice(indent);
        self.contents.extend_from_slice(b"<testcase");
        self.contents.extend_from_slice(b" name=\"");
        escape_xml(name, &mut self.contents)?;
        self.contents.extend_from_slice(b"\" classname=\"");
        escape_xml(class_name, &mut self.contents)?;
        self.contents.extend_from_slice(b"\"");

        let elapsed_seconds = elapsed_ms / bun::time::MS_PER_S as f64;
        let _ = write!(
            &mut self.contents,
            " time=\"{}\"",
            bun_fmt::trimmed_precision::<6>(elapsed_seconds)
        );

        self.contents.extend_from_slice(b" file=\"");
        escape_xml(file, &mut self.contents)?;
        self.contents.extend_from_slice(b"\"");

        if line_number > 0 {
            let _ = write!(&mut self.contents, " line=\"{}\"", line_number);
        }

        let _ = write!(&mut self.contents, " assertions=\"{}\"", assertions);

        use bun_test::Execution::Result as R;
        match status {
            R::Pass if t.earlier_failures.is_empty() => {
                self.contents.extend_from_slice(b" />\n");
            }
            R::Pass => {
                self.contents.extend_from_slice(b">\n");
                for earlier in &t.earlier_failures {
                    self.write_failure(indent, b"flakyFailure", Some(earlier))?;
                }
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"</testcase>\n");
            }
            _ if status.is_fail() => {
                if !self.suite_stack.is_empty() {
                    let last = self.suite_stack.len() - 1;
                    self.suite_stack[last].metrics.failures += 1;
                }
                self.contents.extend_from_slice(b">\n");
                let described = TestFailure::from_result(status, assertions);
                self.write_failure(indent, b"failure", described.as_ref().or(failure))?;
                for earlier in &t.earlier_failures {
                    self.write_failure(indent, b"rerunFailure", Some(earlier))?;
                }
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"</testcase>\n");
            }
            R::SkippedBecauseLabel | R::Skip => {
                if !self.suite_stack.is_empty() {
                    let last = self.suite_stack.len() - 1;
                    self.suite_stack[last].metrics.skipped += 1;
                }
                self.contents.extend_from_slice(b">\n");
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"  <skipped />\n");
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"</testcase>\n");
            }
            R::Todo => {
                if !self.suite_stack.is_empty() {
                    let last = self.suite_stack.len() - 1;
                    self.suite_stack[last].metrics.skipped += 1;
                }
                self.contents.extend_from_slice(b">\n");
                self.contents.extend_from_slice(indent);
                self.contents
                    .extend_from_slice(b"  <skipped message=\"TODO\" />\n");
                self.contents.extend_from_slice(indent);
                self.contents.extend_from_slice(b"</testcase>\n");
            }
            _ => unreachable!(),
        }
        Ok(())
    }

    pub(crate) fn write_to_file(&mut self, path: &[u8]) -> crate::Result<()> {
        if self.contents.is_empty() {
            return Ok(());
        }

        self.end_file(None, None)?;

        {
            let metrics = self.total_metrics;
            let elapsed_time = (bun::time::nano_timestamp() - bun::start_time()) as f64
                / bun::time::NS_PER_S as f64;
            let mut summary = Vec::new();
            {
                // Std::io::Write removed; bun_io::Write (top-level) provides write_fmt.
                let _ = write!(
                    &mut summary,
                    "tests=\"{}\" assertions=\"{}\" failures=\"{}\" skipped=\"{}\" time=\"{}\"",
                    metrics.test_cases,
                    metrics.assertions,
                    metrics.failures,
                    metrics.skipped,
                    elapsed_time,
                );
            }
            self.contents.splice(
                self.offset_of_testsuites_value..self.offset_of_testsuites_value,
                summary.iter().copied(),
            );
            self.contents.extend_from_slice(b"</testsuites>\n");
        }

        match File::make_open(
            path,
            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
            0o664,
        ) {
            bun_sys::Result::Err(err) => {
                Output::err(
                    crate::Error::JUnitReportFailed,
                    "Failed to write JUnit report to {}\n{}",
                    (bstr::BStr::new(path), err),
                );
            }
            bun_sys::Result::Ok(fd) => match File::write_all(&fd, &self.contents) {
                bun_sys::Result::Ok(()) => {}
                bun_sys::Result::Err(err) => {
                    Output::err(
                        crate::Error::JUnitReportFailed,
                        "Failed to write JUnit report to {}\n{}",
                        (bstr::BStr::new(path), err),
                    );
                }
            },
        }
        Ok(())
    }
}

/// An entry of `include` or `exclude`.
struct ReactCompilerEntry {
    /// As written. A pattern like "**/*.stories.tsx" is matched against the file's path relative to the run directory.
    written: Box<[u8]>,
    /// Resolved against the run directory, so that ".", "../../apps/web" and "../.." mean the folders they point to.
    absolute: Box<[u8]>,
}

fn with_forward_slashes(path: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    use std::borrow::Cow;
    if cfg!(windows) {
        let replaced = path.iter().map(|&b| if b == b'\\' { b'/' } else { b });
        Cow::Owned(replaced.collect())
    } else {
        Cow::Borrowed(path)
    }
}

/// Leaked on purpose: every thread's transpiler calls it until the process exits.
pub(crate) fn react_compiler_filter(
    scope: &ReactCompilerScope,
    root: &'static [u8],
) -> &'static (dyn Fn(&[u8]) -> bool + Sync) {
    let entries = |written: &[Box<[u8]>]| -> Vec<ReactCompilerEntry> {
        written
            .iter()
            .map(|written| {
                let written: &[u8] = written;
                let absolute =
                    resolve_path::join_abs_string::<bun_path::platform::Auto>(root, &[written]);
                let absolute = with_forward_slashes(absolute);
                let written = written.strip_prefix(b"./").unwrap_or(written);
                ReactCompilerEntry {
                    written: Box::from(written),
                    absolute: Box::from(absolute.strip_suffix(b"/").unwrap_or(&absolute)),
                }
            })
            .collect()
    };
    let (include, exclude) = (entries(&scope.include), entries(&scope.exclude));
    Box::leak(Box::new(move |path: &[u8]| {
        // A `data:` URL is in no folder, and can be longer than the buffers `relative()` uses.
        if !bun_paths::is_absolute(path) {
            return false;
        }
        // The original of a mocked module is loaded as "file.ts?actual".
        let path = &path[..strings::index_of_char(path, b'?').map_or(path.len(), |at| at as usize)];
        let name = bun_paths::basename(path);
        let stem = &name[..name.len() - bun_paths::extension(name).len()];
        if scanner::TEST_NAME_SUFFIXES
            .iter()
            .any(|suffix| stem.ends_with(suffix))
        {
            return false;
        }
        let relative = with_forward_slashes(resolve_path::relative(root, path));
        let path = with_forward_slashes(path);
        let matches = |entry: &ReactCompilerEntry| {
            // A folder matches everything inside it.
            path.strip_prefix(&*entry.absolute)
                .is_some_and(|rest| rest.is_empty() || rest[0] == b'/')
                || bun_glob::r#match(&entry.written, &relative).matches()
                || bun_glob::r#match(&entry.absolute, &path).matches()
        };
        (include.is_empty() || include.iter().any(matches)) && !exclude.iter().any(matches)
    }))
}

/// Drain the event loop after a file's tests finish, like a node process
/// would before exiting; the vendored-node-test runner opts in via
/// `BUN_TEST_DRAIN_EVENT_LOOP=1` so mustCall()-style exit checks see
/// completed async work. Off by default: bun suites keep exit-after-tests.
fn should_drain_event_loop() -> bool {
    env_var::BUN_TEST_DRAIN_EVENT_LOOP.get().unwrap_or(false)
}

/// jest and vitest never run a test file's `process.on('exit')` listeners; node's test harness asserts from them.
pub(crate) fn skip_exit_listeners(reporter: &CommandLineReporter) -> bool {
    !(reporter.jest.node_test_used || should_drain_event_loop())
}

/// `ExitHandler::requested` at the end of a run, which does not wait for the event loop to run dry.
pub(crate) fn exit_is_requested() -> bool {
    !should_drain_event_loop()
}

pub(crate) struct CommandLineReporter {
    // `TestRunner<'a>` borrows `TestOptions`/regex from the CLI ctx; the
    // reporter is held in a `Box` local to `TestCommand::exec` which never
    // returns before process exit, so `'static` is sound here. Revisit if the
    // reporter ever becomes scoped.
    pub(crate) jest: TestRunner<'static>,
    pub(crate) repeat_count: u32,
    /// Interior-mut: written from `BunTestRoot::on_before_print` via `&CommandLineReporter`
    pub(crate) last_printed_dot: core::cell::Cell<bool>,

    /// When running as a `--parallel` worker, this is the coordinator-assigned
    /// index of the file currently being executed. While set, per-test output
    /// is sent over the IPC pipe instead of to stderr; the coordinator owns
    /// the terminal.
    pub(crate) worker_ipc_file_idx: Option<u32>,
    /// `bun test --aot` over several programs, where plain `bun test` starts no worker: this one has the terminal and prints what
    /// the one process prints. The coordinator still gets its counts.
    pub(crate) worker_stands_for_one_process: bool,

    pub(crate) failures_to_repeat_buf: Vec<u8>,
    pub(crate) skips_to_repeat_buf: Vec<u8>,
    pub(crate) todos_to_repeat_buf: Vec<u8>,

    pub(crate) reporters: ReportersConfig,

    /// `--timings`: loaded before the run, updated per file, written back under `--update-timings`.
    pub(crate) timings: Option<Timings>,
}

#[derive(Default)]
pub(crate) struct ReportersConfig {
    pub(crate) dots: bool,
    pub(crate) only_failures: bool,
    pub(crate) junit: Option<Box<JunitReporter>>,
}

impl CommandLineReporter {
    fn print_test_line<const DIM: bool>(
        status: bun_test::Execution::Result,
        sequence: &mut bun_test::Execution::ExecutionSequence,
        test_entry: &mut bun_test::ExecutionEntry,
        elapsed_ns: u64,
        writer: &mut impl bun_io::Write,
    ) {
        let initial_retry_count = test_entry.retry_count;
        let attempts = (initial_retry_count - sequence.remaining_retry_count) + 1;
        let initial_repeat_count = test_entry.repeat_count;
        let repeats = (initial_repeat_count - sequence.remaining_repeat_count) + 1;
        let mut scopes_stack: BoundedArray<&bun_test::DescribeScope, 64> = BoundedArray::default();
        let mut parent_ = test_entry.base.parent;

        while let Some(scope) = parent_ {
            // SAFETY: scope is a live DescribeScope pointer kept alive for the test run
            let scope = unsafe { &*scope };
            if scopes_stack.push(scope).is_err() {
                break;
            }
            parent_ = scope.base.parent;
        }

        let scopes: &[&bun_test::DescribeScope] = scopes_stack.as_slice();
        let display_label: &[u8] = test_entry.base.name.as_deref().unwrap_or(b"(unnamed)");

        // Quieter output when claude code is in use.
        if !Output::is_ai_agent() || !status.is_pass(bun_test::PendingMode::PendingIsFail) {
            // `color_code`/`line_color_code` literals are inlined at use sites
            // below via `if DIM { ... } else { ... }` to avoid runtime `format!`.

            // `switch (Output.enable_ansi_colors_stderr) { inline else => |_| ... }` — the
            // captured bool was unused except for monomorphization; collapsed to runtime.
            match status {
                bun_test::Execution::Result::FailBecauseExpectedAssertionCount => {
                    // not sent to writer so it doesn't get printed twice
                    let expected_count =
                        if let bun_test::ExpectAssertions::Exact(n) = sequence.expect_assertions {
                            n
                        } else {
                            12345
                        };
                    Output::err(
                        crate::Error::AssertionError,
                        "expected <green>{} assertion{}<r>, but test ended with <red>{} assertion{}<r>\n",
                        (
                            expected_count,
                            if expected_count == 1 { "" } else { "s" },
                            sequence.expect_call_count,
                            if sequence.expect_call_count == 1 {
                                ""
                            } else {
                                "s"
                            },
                        ),
                    );
                    Output::flush();
                }
                bun_test::Execution::Result::FailBecauseExpectedHasAssertions => {
                    Output::err(
                        crate::Error::AssertionError,
                        "received <red>0 assertions<r>, but expected <green>at least one assertion<r> to be called\n",
                        (),
                    );
                    Output::flush();
                }
                bun_test::Execution::Result::FailBecauseTimeout
                | bun_test::Execution::Result::FailBecauseHookTimeout
                | bun_test::Execution::Result::FailBecauseTimeoutWithDoneCallback
                | bun_test::Execution::Result::FailBecauseHookTimeoutWithDoneCallback => {
                    if Output::is_github_action() {
                        Output::print_error(format_args!(
                            "::error title=error: Test \"{}\" timed out after {}ms::\n",
                            bun_fmt::github_action_property(display_label),
                            test_entry.timeout
                        ));
                        Output::flush();
                    }
                }
                _ => {}
            }

            if Output::enable_ansi_colors_stderr() {
                for i in 0..scopes.len() {
                    let index = (scopes.len() - 1) - i;
                    let name: &[u8] = scopes[index].base.name.as_deref().unwrap_or(b"");
                    if name.is_empty() {
                        continue;
                    }
                    let _ = writer.write_all(b" ");

                    let prefix = if DIM {
                        Output::pretty_fmt::<true>("<r><d>")
                    } else {
                        Output::pretty_fmt::<true>("<r>")
                    };
                    let _ = writer.write_all(&prefix);
                    let _ = writer.write_all(name);
                    let _ = writer.write_all(&Output::pretty_fmt::<true>("<d>"));
                    let _ = writer.write_all(b" >");
                }
            } else {
                for i in 0..scopes.len() {
                    let index = (scopes.len() - 1) - i;
                    let name: &[u8] = scopes[index].base.name.as_deref().unwrap_or(b"");
                    if name.is_empty() {
                        continue;
                    }
                    let _ = writer.write_all(b" ");
                    let _ = writer.write_all(name);
                    let _ = writer.write_all(b" >");
                }
            }

            if Output::enable_ansi_colors_stderr() {
                let label_prefix = if DIM {
                    Output::pretty_fmt::<true>("<r><d> ")
                } else {
                    Output::pretty_fmt::<true>("<r><b> ")
                };
                let _ = writer.write_all(&label_prefix);
                let _ = writer.write_all(display_label);
                let _ = writer.write_all(&Output::pretty_fmt::<true>("<r>"));
            } else {
                let _ = writer.write_all(b" ");
                let _ = writer.write_all(display_label);
            }

            // Print attempt count if test was retried (attempts > 1)
            if attempts > 1 {
                let _ = bun_core::write_pretty!(
                    writer,
                    Output::enable_ansi_colors_stderr(),
                    " <d>(attempt {d})<r>",
                    attempts,
                );
            }

            // Print repeat count if test failed on a repeat (repeats > 1)
            if repeats > 1 {
                let _ = bun_core::write_pretty!(
                    writer,
                    Output::enable_ansi_colors_stderr(),
                    " <d>(run {d})<r>",
                    repeats,
                );
            }

            if elapsed_ns > (bun::time::NS_PER_US * 10) {
                let _ = write!(
                    writer,
                    " {}",
                    Output::ElapsedFormatter {
                        colors: Output::enable_ansi_colors_stderr(),
                        duration_ns: elapsed_ns,
                    }
                );
            }

            let _ = writer.write_all(b"\n");

            let colors = Output::enable_ansi_colors_stderr();
            use bun_test::Execution::Result as R;
            match status {
                R::Pending | R::Pass | R::Skip | R::SkippedBecauseLabel | R::Todo | R::Fail => {}

                R::FailBecauseFailingTestPassed | R::FailBecauseFailsTestPassed => {
                    let _ = bun_core::write_pretty!(
                        writer,
                        colors,
                        "  <d>^<r> <red>this test is marked as failing but it passed.<r> <d>Remove `.{s}` if tested behavior now works<r>\n",
                        test_entry.base.mode.tag_name()
                    );
                }
                R::FailBecauseTodoPassed => {
                    let _ = bun_core::write_pretty!(
                        writer,
                        colors,
                        "  <d>^<r> <red>this test is marked as todo but passes.<r> <d>Remove `.todo` if tested behavior now works<r>\n"
                    );
                }
                R::FailBecauseExpectedAssertionCount | R::FailBecauseExpectedHasAssertions => {} // printed above
                R::FailBecauseTimeout => {
                    let _ = bun_core::write_pretty!(
                        writer,
                        colors,
                        "  <d>^<r> <red>this test timed out after {d}ms.<r>\n",
                        test_entry.timeout
                    );
                }
                R::FailBecauseHookTimeout => {
                    let _ = bun_core::write_pretty!(
                        writer,
                        colors,
                        "  <d>^<r> <red>a beforeEach/afterEach hook timed out for this test.<r>\n"
                    );
                }
                R::FailBecauseTimeoutWithDoneCallback => {
                    let _ = bun_core::write_pretty!(
                        writer,
                        colors,
                        "  <d>^<r> <red>this test timed out after {d}ms, before its done callback was called.<r> <d>If a done callback was not intended, remove the last parameter from the test callback function<r>\n",
                        test_entry.timeout
                    );
                }
                R::FailBecauseHookTimeoutWithDoneCallback => {
                    let _ = bun_core::write_pretty!(
                        writer,
                        colors,
                        "  <d>^<r> <red>a beforeEach/afterEach hook timed out before its done callback was called.<r> <d>If a done callback was not intended, remove the last parameter from the hook callback function<r>\n"
                    );
                }
            }
        }
    }

    /// Everything a structured reporter needs about one finished test. Built
    /// once in `handle_test_completed`; the serial runner hands it straight
    /// to `JunitReporter::record_test_case`, a `--parallel` worker encodes it
    /// on its `TestDone` frame and the coordinator replays it.
    fn test_case_report<'a>(
        status: bun_test::Execution::Result,
        buntest: &bun_test::BunTest,
        sequence: &bun_test::Execution::ExecutionSequence,
        test_entry: &'a bun_test::ExecutionEntry,
        elapsed_ns: u64,
        failure: Option<TestFailure>,
        earlier_failures: Vec<TestFailure>,
    ) -> TestCaseReport<'a> {
        let file: &[u8] = if let Some(runner) = jest::Jest::runner() {
            runner.files.items_source()[buntest.file_id as usize]
                .path
                .text
        } else {
            b""
        };
        let file = junit_file_name(file);

        // Innermost first while walking up; reversed below.
        let mut scopes: Vec<(&'a [u8], u32)> = Vec::new();
        let mut parent = test_entry.base.parent.map(|p| p.cast_const());
        while let Some(scope) = parent {
            if scopes.len() == 64 {
                break;
            }
            // SAFETY: describe scopes outlive the file's test run.
            let scope: &'a bun_test::DescribeScope = unsafe { &*scope };
            if let Some(name) = scope.base.name.as_deref() {
                scopes.push((name, scope.base.line_no));
            }
            parent = scope.base.parent.map(|p| p.cast_const());
        }
        scopes.reverse();

        TestCaseReport {
            file,
            scopes,
            name: test_entry.base.name.as_deref().unwrap_or(b"(unnamed)"),
            status,
            assertions: sequence.expect_call_count,
            elapsed_ns,
            line_number: test_entry.base.line_no,
            failure,
            earlier_failures,
        }
    }

    /// An error outside of any test fails the run, so structured reporters get it as a failed test case of its file.
    pub(crate) fn record_unhandled_error(&mut self, file_id: jest::FileId, failure: TestFailure) {
        let Some(runner) = jest::Jest::runner() else {
            return;
        };
        let report = TestCaseReport {
            file: junit_file_name(runner.files.items_source()[file_id as usize].path.text),
            scopes: Vec::new(),
            name: b"(unhandled error)",
            status: bun_test::Execution::Result::Fail,
            assertions: 0,
            elapsed_ns: 0,
            line_number: 0,
            failure: Some(failure),
            earlier_failures: Vec::new(),
        };
        if let Some(idx) = self.worker_ipc_file_idx {
            ParallelRunner::worker_emit_test_done(idx, b"", Some(&report));
        } else if let Some(junit) = self.reporters.junit.as_mut() {
            junit.record_test_case(&report).expect("oom");
        }
    }

    #[inline]
    pub(crate) fn summary(&mut self) -> &mut Summary {
        &mut self.jest.summary
    }

    pub(crate) fn handle_test_completed(
        buntest: &mut bun_test::BunTest,
        sequence: &mut bun_test::Execution::ExecutionSequence,
        test_entry: &mut bun_test::ExecutionEntry,
        elapsed_ns: u64,
    ) {
        let mut output_buf: Vec<u8> = Vec::new();

        let initial_length = output_buf.len();
        let writer = &mut output_buf;

        let result = sequence.result;
        if result != bun_test::Execution::Result::SkippedBecauseLabel {
            // SAFETY: `BunTest.reporter` is `NonNull<CommandLineReporter>` with write
            // provenance from `enter_file`'s `&mut`; single-threaded; reporter outlives
            // every BunTest. Scoped to this block so the SharedReadOnly tag is dead
            // before the `&mut` derived from the same `NonNull` below
            // (stacked-borrows hygiene).
            let reporter_ref: Option<&CommandLineReporter> =
                buntest.reporter.map(|p| unsafe { &*p.as_ptr() });
            let basic = result.basic_result();
            let dots_branch = reporter_ref.is_some_and(|r| r.reporters.dots)
                && matches!(
                    basic,
                    bun_test::BasicResult::Pass
                        | bun_test::BasicResult::Skip
                        | bun_test::BasicResult::Todo
                        | bun_test::BasicResult::Pending
                );
            if dots_branch {
                let colors = Output::enable_ansi_colors_stderr();
                match basic {
                    bun_test::BasicResult::Pass => {
                        let _ = bun_core::write_pretty!(writer, colors, "<r><green>.<r>");
                    }
                    bun_test::BasicResult::Skip => {
                        let _ = bun_core::write_pretty!(writer, colors, "<r><yellow>.<d>");
                    }
                    bun_test::BasicResult::Todo => {
                        let _ = bun_core::write_pretty!(writer, colors, "<r><magenta>.<r>");
                    }
                    bun_test::BasicResult::Pending => {
                        let _ = bun_core::write_pretty!(writer, colors, "<r><d>.<r>");
                    }
                    bun_test::BasicResult::Fail => {
                        let _ = bun_core::write_pretty!(writer, colors, "<r><red>.<r>");
                    }
                }
                reporter_ref.unwrap().last_printed_dot.set(true);
            } else if basic != bun_test::BasicResult::Fail
                && reporter_ref.is_some_and(|r| r.reporters.only_failures)
            {
                // when using --only-failures, only print failures
            } else {
                buntest.bun_test_root.on_before_print();

                if Output::enable_ansi_colors_stderr() {
                    let _ = writer.write_all(&fmt_status_text_line(result, true));
                } else {
                    let _ = writer.write_all(&fmt_status_text_line(result, false));
                }
                let dim = match basic {
                    bun_test::BasicResult::Todo => {
                        if let Some(runner) = jest::Jest::runner() {
                            !runner.run_todo
                        } else {
                            true
                        }
                    }
                    bun_test::BasicResult::Skip | bun_test::BasicResult::Pending => true,
                    bun_test::BasicResult::Pass | bun_test::BasicResult::Fail => false,
                };
                if dim {
                    Self::print_test_line::<true>(result, sequence, test_entry, elapsed_ns, writer);
                } else {
                    Self::print_test_line::<false>(
                        result, sequence, test_entry, elapsed_ns, writer,
                    );
                }
                if basic == bun_test::BasicResult::Fail {
                    run_compiled::write_note_on_refusal(writer);
                }
            }
        }
        let formatted_line = &output_buf[initial_length..];

        let Some(this) = buntest.reporter else {
            let _ = Output::error_writer().write_all(formatted_line);
            return;
        };
        // SAFETY: `BunTest.reporter` is `NonNull<CommandLineReporter>` with write
        // provenance from `enter_file`'s `&mut`; single-threaded test runner,
        // sole writer for the duration of this completion callback, and the
        // shared borrow above is dead.
        let this: &mut CommandLineReporter = unsafe { &mut *this.as_ptr() };

        // Under `--parallel` the flag is forwarded to workers, whose records
        // the coordinator replays into its own `JunitReporter`.
        let report = this.jest.test_options.reporters.junit.then(|| {
            let failure = sequence.failure.take();
            let earlier = core::mem::take(&mut sequence.earlier_failures);
            Self::test_case_report(
                result, buntest, sequence, test_entry, elapsed_ns, failure, earlier,
            )
        });
        if let Some(idx) = this.worker_ipc_file_idx {
            let line_for_coordinator = match this.worker_stands_for_one_process {
                true => {
                    let _ = Output::error_writer().write_all(formatted_line);
                    &[][..]
                }
                false => formatted_line,
            };
            ParallelRunner::worker_emit_test_done(idx, line_for_coordinator, report.as_ref());
        } else {
            let _ = Output::error_writer().write_all(formatted_line);
            if let (Some(junit), Some(report)) = (this.reporters.junit.as_mut(), &report) {
                junit.record_test_case(report).expect("oom");
            }
        }

        if !this.reporters.dots && !this.reporters.only_failures {
            match sequence.result.basic_result() {
                bun_test::BasicResult::Skip => this
                    .skips_to_repeat_buf
                    .extend_from_slice(&output_buf[initial_length..]),
                bun_test::BasicResult::Todo => this
                    .todos_to_repeat_buf
                    .extend_from_slice(&output_buf[initial_length..]),
                bun_test::BasicResult::Fail => this
                    .failures_to_repeat_buf
                    .extend_from_slice(&output_buf[initial_length..]),
                bun_test::BasicResult::Pass | bun_test::BasicResult::Pending => {}
            }
        }

        use bun_test::Execution::Result as R;
        match sequence.result {
            R::Pending => {}
            R::Pass => this.summary().pass += 1,
            R::Skip => this.summary().skip += 1,
            R::Todo => this.summary().todo += 1,
            R::SkippedBecauseLabel => this.summary().skipped_because_label += 1,

            R::Fail
            | R::FailBecauseFailingTestPassed
            | R::FailBecauseFailsTestPassed
            | R::FailBecauseTodoPassed
            | R::FailBecauseExpectedHasAssertions
            | R::FailBecauseExpectedAssertionCount
            | R::FailBecauseTimeout
            | R::FailBecauseTimeoutWithDoneCallback
            | R::FailBecauseHookTimeout
            | R::FailBecauseHookTimeoutWithDoneCallback => {
                this.summary().fail += 1;

                if this.summary().fail == this.jest.bail {
                    this.bail_out(VirtualMachine::get().as_mut());
                }
            }
        }
        this.summary().expectations = this
            .summary()
            .expectations
            .saturating_add(sequence.expect_call_count);
    }

    pub(crate) fn print_summary(&mut self) {
        let summary_ = self.summary();
        let tests = summary_.fail + summary_.pass + summary_.skip + summary_.todo;
        let files = summary_.files;

        pretty_error!(
            "Ran {} test{} across {} file{}. ",
            tests,
            if tests == 1 { "" } else { "s" },
            files,
            if files == 1 { "" } else { "s" }
        );

        Output::print_start_end(bun::start_time(), bun::time::nano_timestamp());
    }

    /// Prints that `--bail` hit its failure count, then exits with code 1. Tears down the VM the same way `exec` does.
    pub(crate) fn bail_out(&mut self, vm: &mut VirtualMachine) -> ! {
        let is_worker = self.worker_ipc_file_idx.is_some();
        if is_worker {
            ParallelRunner::worker_ends_at_bail(self, vm);
        } else {
            self.print_summary();
            pretty_error!(
                "\nBailed out after {} failure{}<r>\n",
                self.jest.bail,
                if self.jest.bail == 1 { "" } else { "s" }
            );
            Output::flush();
            self.write_junit_report_if_needed();
            self.write_timings_if_needed();
        }

        vm.exit_handler.exit_code = u8::from(!is_worker);
        vm.exit_handler.skip_exit_listeners = skip_exit_listeners(self);
        vm.exit_handler.requested = true;
        vm.run_with_api_lock_mut(VirtualMachine::on_exit);
        // Exit listeners need the runner, so release the `bun:test` GC roots and clear `RUNNER`
        // after they run. Finalizers in the teardown GC must not see a half-torn-down `TestRunner`.
        self.jest.bun_test_root.deinit_for_exit();
        // SAFETY: `RUNNER` is a `RacyCell` touched only from the single JS thread;
        // no concurrent reader exists on this shutdown path.
        unsafe {
            jest::Jest::RUNNER.write(None);
        }
        vm.run_with_api_lock_mut(|vm| vm.global_exit())
    }

    /// Like the JUnit report, called before every exit path (including bail) so measured durations aren't lost.
    #[optimize(size)]
    pub(crate) fn write_timings_if_needed(&mut self) {
        if self.jest.test_options.update_timings
            && self.worker_ipc_file_idx.is_none()
            && let Some(timings) = self.timings.as_mut()
        {
            timings.write(self.jest.test_options.shard.is_some());
        }
    }

    /// Writes the JUnit reporter output file if a JUnit reporter is active and
    /// an outfile path was configured. This must be called before any early exit
    /// (e.g. bail) so that the report is not lost.
    #[optimize(size)]
    pub(crate) fn write_junit_report_if_needed(&mut self) {
        if let Some(junit) = self.reporters.junit.as_mut() {
            if let Some(outfile) = self.jest.test_options.reporter_outfile.as_deref() {
                let _ = junit.write_to_file(outfile);
            }
        }
    }

    /// `bun test --aot --coverage`: the files that ran as compiled code join those that JSC has counted.
    pub(crate) fn add_compiled_files_to_coverage(vm: &mut VirtualMachine) {
        let mut files: Vec<(Vec<u8>, Vec<u64>)> = Vec::new();
        bun_jsc::compiled_program::for_each_counted_file(
            vm.global(),
            &mut |description, counts| {
                files.push((description.to_vec(), counts.to_vec()));
            },
        );
        for (description, counts) in &files {
            let Some(end_of_path) = strings::index_of_char_usize(description, b'\n') else {
                continue;
            };
            let (path, ranges) = (&description[..end_of_path], &description[end_of_path + 1..]);
            if !BunTest__shouldGenerateCodeCoverage(&bun_core::StringView::from_bytes(path)) {
                continue;
            }
            let Ok(text) = File::read_from(Fd::cwd(), path) else {
                continue;
            };
            let results_of_macros: Vec<(i32, Vec<u8>)> = strings::split(ranges, b"\n")
                .filter_map(|line| {
                    let mut words = line.strip_prefix(b"m ")?.splitn(3, |&byte| byte == b' ');
                    let start = bun_core::fmt::parse_int::<i32>(words.next()?, 10).ok()?;
                    Some((start, words.nth(1)?.to_vec()))
                })
                .collect();
            let Some(transpiled) =
                bun_js_parser_jsc::Macro::with_results_of_macros(results_of_macros, || {
                    crate::jsc_hooks::transpile_as_loaded(vm.global(), path, &text)
                })
            else {
                continue;
            };
            ByteRangeMapping::add_compiled_file(
                path,
                &text,
                &transpiled.source_code,
                transpiled.already_bundled,
                ranges,
                counts,
            );
        }
    }

    /// This process's coverage, one `Report` per instrumented file, sorted by
    /// path, with `coveragePathIgnorePatterns` applied.
    pub(crate) fn for_each_coverage_report(
        vm: &mut VirtualMachine,
        opts: &CodeCoverageOptions,
        mut each: impl FnMut(CodeCoverageReport<'_>),
    ) {
        let Some(map) = ByteRangeMapping::map() else {
            return;
        };
        // SAFETY: thread-local Box pinned for the thread; sole `&mut` for the
        // collection loop below (single-threaded CLI report path).
        let map = unsafe { &mut *map.as_ptr() };
        let relative_dir = FileSystem::get().top_level_dir();
        let ignore_patterns: Vec<bun_glob::Prepared<&[u8]>> = (opts
            .ignore_patterns
            .iter()
            .map(|it| bun_glob::Prepared::new(&**it)))
        .collect();
        let mut byte_ranges: Vec<&mut ByteRangeMapping> = Vec::with_capacity(map.len());
        for entry in map.values_mut() {
            if !coverage::is_ignored(&ignore_patterns, relative_dir, entry.source_url.slice()) {
                byte_ranges.push(entry);
            }
        }
        index_sort::sort_slice_by(&mut byte_ranges, coverage::is_less_than_cmp);

        for entry in byte_ranges {
            if let Some(report) =
                CodeCoverageReport::generate(vm.global(), entry, opts.ignore_sourcemap)
            {
                each(report);
            }
        }
    }

    /// Returns false if `lcov.info` could not be written.
    pub(crate) fn generate_code_coverage(
        &mut self,
        vm: &mut VirtualMachine,
        opts: &mut CodeCoverageOptions,
    ) -> bool {
        let _trace = bun::perf::trace("TestCommand.printCodeCoverage");
        Self::add_compiled_files_to_coverage(vm);
        if ByteRangeMapping::map().is_none_or(|m| {
            // SAFETY: see `for_each_coverage_report`.
            unsafe { m.as_ref() }.is_empty()
        }) {
            return true;
        }
        let mut reports: Vec<CodeCoverageReport<'static>> = Vec::new();
        Self::for_each_coverage_report(vm, opts, |report| reports.push(report.into_owned()));
        if let Err(err) = print_coverage_reports(opts, &reports) {
            Output::err(err, "Failed to write lcov.info", ());
            return false;
        }
        true
    }
}

/// Write the `--coverage` text table to stderr and/or `lcov.info` for
/// `reports` (sorted by path), and set `opts.fractions.failing`. The serial
/// runner passes this process's reports; the `--parallel` coordinator passes
/// reports merged from every worker. Errors only from writing `lcov.info`.
#[optimize(size)]
pub(crate) fn print_coverage_reports(
    opts: &mut CodeCoverageOptions,
    reports: &[CodeCoverageReport<'_>],
) -> bun_sys::Result<()> {
    if Output::enable_ansi_colors_stderr() {
        print_coverage_reports_::<true>(opts, reports)
    } else {
        print_coverage_reports_::<false>(opts, reports)
    }
}

fn print_coverage_reports_<const COLORS: bool>(
    opts: &mut CodeCoverageOptions,
    reports: &[CodeCoverageReport<'_>],
) -> bun_sys::Result<()> {
    let relative_dir = FileSystem::get().top_level_dir();
    let thresholds = opts.fractions;

    let fractions: Vec<Fraction> = reports.iter().map(|r| r.fraction(&thresholds)).collect();
    let failing = fractions.iter().any(|f| f.failing);
    opts.fractions.failing = failing;

    if opts.reporters.text {
        print_coverage_table::<COLORS>(relative_dir, &thresholds, reports, &fractions, failing);
    }
    if opts.reporters.lcov {
        write_lcov_report(opts, relative_dir, reports)?;
    }
    Ok(())
}

fn print_coverage_table<const COLORS: bool>(
    relative_dir: &[u8],
    thresholds: &Fraction,
    reports: &[CodeCoverageReport<'_>],
    fractions: &[Fraction],
    failing: bool,
) {
    use coverage::text;
    let thresholds = *thresholds;
    let max_filepath_length = reports
        .iter()
        .map(|r| resolve_path::relative(relative_dir, &r.source_url).len())
        .fold(b"All files".len(), usize::max);

    let zero = Fraction {
        functions: 0.0,
        lines: 0.0,
        stmts: 0.0,
        failing: false,
    };
    let mut avg = zero;
    for f in fractions {
        avg.functions += f.functions;
        avg.lines += f.lines;
        avg.stmts += f.stmts;
    }
    let avg_thresholds = if fractions.is_empty() {
        zero
    } else {
        let n = fractions.len() as f64;
        avg.functions /= n;
        avg.lines /= n;
        avg.stmts /= n;
        thresholds
    };

    // Writes below target a Vec and cannot fail.
    let mut out: Vec<u8> = Vec::new();
    let separator = |out: &mut Vec<u8>| {
        let _ = bun_core::write_pretty!(out, COLORS, "<r><d>");
        out.resize(out.len() + max_filepath_length + 2, b'-');
        let _ =
            bun_core::write_pretty!(out, COLORS, "|---------|---------|-------------------<r>\n");
    };
    separator(&mut out);
    out.extend_from_slice(b"File");
    out.resize(out.len() + max_filepath_length - b"File".len() + 1, b' ');
    let _ = bun_core::write_pretty!(
        out,
        COLORS,
        " <d>|<r> % Funcs <d>|<r> % Lines <d>|<r> Uncovered Line #s\n"
    );
    separator(&mut out);
    let _ = text::write_format_with_values::<COLORS>(
        b"All files",
        max_filepath_length,
        avg,
        avg_thresholds,
        failing,
        &mut out,
        false,
    );
    let _ = bun_core::write_pretty!(out, COLORS, "<r><d> |<r>\n");
    for (report, fraction) in reports.iter().zip(fractions) {
        let _ = text::write_format::<COLORS>(
            report,
            max_filepath_length,
            fraction,
            &thresholds,
            relative_dir,
            &mut out,
        );
        out.push(b'\n');
    }
    separator(&mut out);

    // A closed stderr is not a reason to fail the run.
    let _ = Output::error_writer().write_all(&out);
    Output::flush();
}

/// Render to `<reports_directory>/.lcov.info.<hex>.tmp` and rename it over
/// `lcov.info`, so an interrupted run never leaves a truncated report.
#[optimize(size)]
fn write_lcov_report(
    opts: &CodeCoverageOptions,
    relative_dir: &[u8],
    reports: &[CodeCoverageReport<'_>],
) -> bun_sys::Result<()> {
    let mut contents: Vec<u8> = Vec::with_capacity(64 * 1024);
    for report in reports {
        // Writing into a Vec cannot fail.
        let _ = coverage::lcov::write_format(report, relative_dir, &mut contents);
    }

    let mut rand = [0u8; 8];
    bun_boringssl_sys::rand_bytes(&mut rand);
    let mut tmpname: Vec<u8> = Vec::new();
    let _ = write!(
        &mut tmpname,
        ".lcov.info.{}.tmp",
        bun_core::fmt::hex_lower(&rand)
    );
    let too_long = || {
        bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open)
            .with_path(&opts.reports_directory)
    };
    let mut tmp_buf = bun_paths::path_buffer_pool::get();
    let tmp_path = resolve_path::join_abs_string_buf_z_checked::<bun_path::platform::Auto>(
        relative_dir,
        &mut tmp_buf,
        &[&opts.reports_directory, &tmpname],
    )
    .ok_or_else(too_long)?;
    let mut buf = bun_paths::path_buffer_pool::get();
    let path = resolve_path::join_abs_string_buf_z_checked::<bun_path::platform::Auto>(
        relative_dir,
        &mut buf,
        &[&opts.reports_directory, b"lcov.info"],
    )
    .ok_or_else(too_long)?;
    if let Some(dir) = bun_path::dirname(path.as_bytes()) {
        let mut fs = crate::node::fs::NodeFS::default();
        let _ = fs.mkdir_recursive(&crate::node::fs::args::Mkdir {
            path: crate::node::PathLike::borrowed(dir),
            always_return_none: true,
            recursive: true,
            ..Default::default()
        });
    }

    let file = File::openat(
        Fd::cwd(),
        tmp_path,
        bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::TRUNC | bun_sys::O::CLOEXEC,
        0o644,
    )?;
    let written = file.write_all(&contents);
    drop(file);
    let moved = match written {
        Ok(()) => bun_sys::move_file_z(Fd::cwd(), tmp_path, Fd::cwd(), path),
        err => err,
    };
    if moved.is_err() {
        let _ = bun_sys::unlink(tmp_path);
    }
    moved
}

#[unsafe(no_mangle)]
extern "C" fn BunTest__shouldGenerateCodeCoverage(test_name_str: &bun_core::String) -> bool {
    let zig_slice = test_name_str.to_utf8();
    // In this particular case, we don't actually care about non-ascii latin1 characters.
    // so we skip the ascii check
    let slice: &[u8] = zig_slice.slice();

    // always ignore node_modules.
    if strings::contains(slice, b"/node_modules/") || strings::contains(slice, b"\\node_modules\\")
    {
        return false;
    }

    // SAFETY: `VirtualMachine::get()` returns the process-lifetime VM pointer; only
    // called from the JS thread once a VM exists.
    let options = &VirtualMachine::get().as_mut().transpiler.options;

    // Skip the wrapper modules Bun generates for these suffixes. Other queries (a plugin's `./a.vue?x`) are user code.
    if let Some(query) = strings::index_of_char_usize(slice, b'?') {
        use bun_bundler::options::ImportSuffix;
        let by_extension = options.loader(bun_path::extension(&slice[..query]));
        if matches!(
            ImportSuffix::find(&slice[query..], Some(by_extension)),
            Some(ImportSuffix::Inline | ImportSuffix::Init | ImportSuffix::Worker(_))
        ) {
            return false;
        }
    }

    let ext = bun_path::extension(slice);
    let loader_by_ext = options.loader(ext);

    // allow file loader just incase they use a custom loader with a non-standard extension
    if !(loader_by_ext.is_javascript_like() || loader_by_ext == bun_ast::Loader::File) {
        return false;
    }

    if let Some(runner) = jest::Jest::runner() {
        if runner.test_options.coverage.skip_test_files {
            let name_without_extension = &slice[0..slice.len() - ext.len()];
            for suffix in scanner::TEST_NAME_SUFFIXES {
                if strings::ends_with(name_without_extension, suffix) {
                    return false;
                }
            }
        }
    }

    true
}

pub(crate) struct TestCommand;

impl TestCommand {
    // pub use bun_options_types::code_coverage_options::{CodeCoverageOptions, Reporter, Reporters};
    // Re-exports moved to top-level `use` per crate map.

    #[optimize(size)]
    pub(crate) fn exec(ctx: Command::Context) -> crate::Result<()> {
        Output::IS_GITHUB_ACTION.store(
            Output::is_github_action(),
            core::sync::atomic::Ordering::Relaxed,
        );

        if !ctx.test_options.test_worker && !run_compiled::is_second_process() {
            // print the version so you know its doing stuff if it takes a sec
            let w = Output::writer();
            let colors = Output::enable_ansi_colors_stdout();
            let _ = w.write_all(&if colors {
                Output::pretty_fmt::<true>(const_format::concatcp!(
                    "<r><b>bun test <r><d>v",
                    Global::package_json_version_with_sha,
                    "<r>"
                ))
            } else {
                Output::pretty_fmt::<false>(const_format::concatcp!(
                    "<r><b>bun test <r><d>v",
                    Global::package_json_version_with_sha,
                    "<r>"
                ))
            });
            if ctx.test_options.parallel > 0 {
                if colors {
                    let _ = write!(
                        w,
                        " \x1b[1;2m{}\u{00d7} PARALLEL\x1b[0m",
                        ctx.test_options.parallel
                    );
                } else {
                    let _ = write!(w, " {}x PARALLEL", ctx.test_options.parallel);
                }
            }
            let _ = w.write_all(b"\n");
            Output::flush();
        }

        // `exec()` never returns before process exit, so the heap allocation
        // outlives all observers.
        let mut env_loader: Box<DotEnv::Loader> = Box::new(DotEnv::Loader::init());
        crate::cli::startup_options::refuse_code_the_compiler_did_not_see();
        jsc::initialize(jsc::InitializeOptions {
            short_lived_globals: ctx.test_options.isolate
                && !run_compiled::test_files_share_global(ctx),
            runs_compiled_code: run_compiled::runs_compiled_code(),
            locks_builtins: run_compiled::is_checked(),
            ..Default::default()
        });
        run_compiled::list_refused_changes();
        bun_http::http_thread::init(&Default::default());

        let enable_random = ctx.test_options.randomize;
        // `describe.shuffle` needs a seed even without --randomize.
        let seed: u32 = ctx
            .test_options
            .seed
            .unwrap_or_else(|| bun::fast_random() as u32); // @truncate
        // seed is limited to u32 so storing it in js doesn't lose precision
        // Persist the chosen seed so --parallel forwards it to every worker;
        // otherwise each worker would draw its own and the printed --seed=N
        // would not reproduce the run.
        ctx.test_options.seed = Some(seed);
        // `DefaultPrng` is `Copy`, so pass the prng by value to TestRunner
        // and keep a local copy for shuffling.
        let random_instance: Option<bun::rand::DefaultPrng> = if enable_random {
            Some(bun::rand::DefaultPrng::init(seed as u64))
        } else {
            None
        };

        jsc::virtual_machine::isBunTest.store(true, core::sync::atomic::Ordering::Relaxed);

        // Keep an owned `Box` local — `exec()` never returns before process
        // exit, so the heap allocation outlives all raw-pointer observers
        // (e.g. `Jest::RUNNER` below).
        let mut reporter: Box<CommandLineReporter> = Box::new(CommandLineReporter {
            jest: TestRunner {
                default_timeout_ms: ctx.test_options.default_timeout_ms,
                concurrent: ctx.test_options.concurrent,
                concurrent_test_glob: ctx
                    .test_options
                    .concurrent_test_glob
                    .take()
                    .map(|globs| globs.into_iter().map(bun_glob::Prepared::new).collect()),
                run_todo: ctx.test_options.run_todo,
                only: ctx.test_options.only,
                bail: ctx.test_options.bail,
                max_concurrency: ctx.test_options.max_concurrency,
                // `test_filter_regex` is an erased `*mut RegularExpression` (see
                // options_types::context).
                filter_regex: ctx
                    .test_options
                    .test_filter_regex()
                    .map(|p| jsc::RegularExpression::opaque_ref(p.as_ptr().cast())),
                snapshots: Snapshots::init(ctx.test_options.update_snapshots),
                bun_test_root: bun_test::BunTestRoot::init(),
                // `TestRunner` cannot derive `Default` because of the
                // `&'a TestOptions` field, so spell the remaining fields out
                // explicitly.
                current_file: jest::CurrentFile::default(),
                files: jest::FileList::default(),
                index: jest::FileMap::default(),
                default_timeout_override: u32::MAX,
                vi_config: Default::default(),
                vi_config_of_preload: Default::default(),
                // SAFETY: lifetime-erase to `'static`; `ctx` is the
                // process-lifetime CLI context and `exec()` never returns.
                test_options: unsafe { bun_ptr::detach_lifetime_ref(&ctx.test_options) },
                unhandled_errors_between_tests: 0,
                summary: Summary::default(),
                node_test_used: false,
                environment_is_left: false,
            },
            repeat_count: 1,
            last_printed_dot: core::cell::Cell::new(false),
            worker_ipc_file_idx: None,
            worker_stands_for_one_process: false,
            failures_to_repeat_buf: Vec::new(),
            skips_to_repeat_buf: Vec::new(),
            todos_to_repeat_buf: Vec::new(),
            reporters: ReportersConfig::default(),
            timings: if ctx.test_options.test_worker || ctx.test_options.timings_files.is_empty() {
                None
            } else {
                Some(Timings::load(&ctx.test_options.timings_files))
            },
        });
        // `defer { if (reporter.reporters.junit) |fr| fr.deinit() }` — handled by Drop.
        reporter.repeat_count = ctx.test_options.repeat_count.max(1);
        // SAFETY: single-threaded CLI startup; `reporter` is a `Box` that lives
        // until `exec()` exits the process, so `&mut reporter.jest` remains
        // valid for the process lifetime.
        unsafe {
            jest::Jest::RUNNER.write(Some(core::ptr::NonNull::from(&mut reporter.jest)));
        }
        // `reporter.jest.test_options` is initialised in the struct
        // literal above (lifetime-erased); the post-init assignment is dropped.

        if ctx.test_options.reporters.junit && !ctx.test_options.test_worker {
            reporter.reporters.junit = Some(JunitReporter::init(
                ctx.test_options.reporters.junit_suites.unwrap_or_default(),
            ));
        }
        if ctx.test_options.reporters.dots {
            reporter.reporters.dots = true;
        }
        if ctx.test_options.reporters.only_failures {
            reporter.reporters.only_failures = true;
        } else if Output::is_ai_agent() {
            reporter.reporters.only_failures = true; // only-failures defaults to true for ai agents
        }

        // The worker's environment already holds the coordinator's env file values, and `BUN_OPTIONS` in it can carry `--env-file`.
        if ctx.test_options.test_worker || run_compiled::has_environment_of_first_process() {
            ctx.args.env_files.clear();
            ctx.args.disable_default_env_files = true;
        }

        bun_ast::initialize_store();
        // SAFETY: `init` returns the heap-allocated process-lifetime VM; deref once.
        let vm: &mut VirtualMachine = unsafe {
            &mut *VirtualMachine::init(jsc::virtual_machine::InitOptions {
                // Clone (not take): ParallelRunner::run_as_coordinator → build_worker_argv
                // reads ctx.args.{conditions,define,loaders,tsconfig_override,drop,
                // main_fields,extension_order,feature_flags,preserve_symlinks,
                // allow_addons,allow_ffi_cc,jsx} after this point to forward them
                // to workers.
                transform_options: ctx.args.clone(),
                debugger: core::mem::take(&mut ctx.runtime_options.debugger),
                log: core::ptr::NonNull::new(ctx.log),
                env_loader: core::ptr::NonNull::new(&raw mut *env_loader),
                smol: ctx.runtime_options.smol,
                is_main_thread: true,
                graph: run_compiled::graph(),
                ..Default::default()
            })?
        };
        vm.argv = core::mem::take(&mut ctx.passthrough);
        // Clone (not take): build_worker_argv reads ctx.preloads to forward --preload.
        vm.preload.clone_from(&ctx.preloads);
        vm.transpiler.options.rewrite_jest_for_tests = true;
        vm.transpiler.options.vitest_globals =
            ctx.test_options.globals == Some(TestGlobals::Vitest);
        if let Some(scope) = &ctx.test_options.react_compiler {
            vm.transpiler.options.react_compiler = bun_ast::runtime::ReactCompilerMode::Client;
            vm.transpiler.options.react_compiler_filter = Some(react_compiler_filter(
                scope,
                FileSystem::instance().top_level_dir(),
            ));
        }
        bun_http::EXPERIMENTAL_HTTP2_CLIENT_FROM_CLI.store(
            ctx.runtime_options.experimental_http2_fetch,
            core::sync::atomic::Ordering::Relaxed,
        );
        bun_http::EXPERIMENTAL_HTTP3_CLIENT_FROM_CLI.store(
            ctx.runtime_options.experimental_http3_fetch,
            core::sync::atomic::Ordering::Relaxed,
        );
        vm.transpiler.options.env.behavior =
            bun_bundler::options::EnvBehavior::LoadAllWithoutInlining;

        let node_env_entry = env_loader.map.get_or_put_without_value(b"NODE_ENV")?;
        if !node_env_entry.found_existing {
            *node_env_entry.key_ptr = Box::<[u8]>::from(&**node_env_entry.key_ptr);
            *node_env_entry.value_ptr = DotEnv::HashTableValue {
                value: Box::<[u8]>::from(b"test" as &[u8]),
            };
        }

        vm.transpiler.configure_defines()?;
        if run_compiled::is_requested(ctx) {
            run_compiled::hand_on_environment(&env_loader.map);
        }

        vm.load_extra_env_and_source_code_printer();
        vm.is_main_thread = true;
        VirtualMachine::set_is_main_thread_vm(true);

        if ctx.test_options.isolate {
            vm.test_isolation_enabled = true;
            vm.auto_killer.enabled = true;
        }
        vm.test_isolation_state.shares_global = run_compiled::test_files_share_global(ctx);
        crate::jsc_hooks::timer_all_mut().zero_delay_is_due_when_idle = true;

        if ctx.test_options.coverage.enabled {
            vm.transpiler.options.code_coverage = true;
            vm.transpiler.options.minify_syntax = false;
            vm.transpiler.options.minify_identifiers = false;
            vm.transpiler.options.minify_whitespace = false;
            vm.transpiler.options.dead_code_elimination = false;
            vm.global().vm().enable_control_flow_profiler();
        }

        // For tests, we default to UTC time zone
        // unless the user inputs TZ="", in which case we use local time zone
        let mut tz_name: &[u8] =
            // We use the string "Etc/UTC" instead of "UTC" so there is no normalization difference.
            b"Etc/UTC";

        // SAFETY: `vm.transpiler.env` is the process-lifetime DotEnv loader pointer.
        if let Some(tz) = unsafe { (*vm.transpiler.env).get(b"TZ") } {
            tz_name = tz;
        }

        if !tz_name.is_empty() {
            _ = vm
                .global()
                .set_time_zone(&EncodedSlice::from_bytes(tz_name));
        }
        vm.test_isolation_state.time_zone = Some(Box::from(tz_name));
        if vm.test_isolation_enabled {
            vm.test_isolation_state.proxy_env = Some(
                bun_jsc::rare_data::ProxyEnvSnapshot::capture(&vm.env_loader().map),
            );
            vm.test_isolation_state.synthetic_allocation_limit =
                Some(bun_jsc::virtual_machine::synthetic_allocation_limit());
        }

        if ctx.test_options.test_worker {
            // Worker mode: skip discovery; files arrive over stdin and
            // results go out over fd 3. Never returns.
            crate::run_command::start_profilers(vm, ctx);
            ParallelRunner::run_as_worker(&mut reporter, vm, ctx);
        }
        if run_compiled::builds_test_part() {
            run_compiled::log_step_of_build("the process is set up");
            // What is asked of the resolver ahead of the build is a guess at what the files import, and prose reads as an import.
            // The build itself says what is wrong with a file.
            let mut unread_log = bun_ast::Log::init();
            // SAFETY: the resolver and `unread_log` outlive the guard.
            let log_scope = unsafe {
                bun_resolver::Resolver::scoped_log(
                    &raw mut vm.transpiler.resolver,
                    core::ptr::NonNull::from(&mut unread_log),
                )
            };
            let mut entry_points = run_compiled::read_test_part();
            let test_files = entry_points.clone();
            if let Some(aot) = ctx.bundler_options.aot.as_mut() {
                aot.test_files_of_run = test_files.iter().map(|path| path.to_vec()).collect();
                aot.preloads_of_test_run = ctx.preloads.iter().map(|path| path.to_vec()).collect();
            }
            let test_files_and_preloads: Vec<Box<[u8]>> =
                (entry_points.iter().chain(&ctx.preloads).cloned()).collect();
            let has_window = has_file_with_window(
                entry_points.iter().map(|path| &**path),
                ctx.test_options.environment,
            );
            // What the test files share is a program of its own, which is built once. The build does not see the test files.
            let builds_what_is_shared = run_compiled::builds_what_test_parts_share();
            if let Some(aot) = (ctx.bundler_options.aot.as_mut()).filter(|_| builds_what_is_shared)
            {
                aot.main_modules_beside_entry_points =
                    entry_points.iter().map(|path| path.to_vec()).collect();
            }
            let is_above_what_is_shared = run_compiled::is_above_program_of_run();
            let builds_packages_alone = run_compiled::builds_packages_alone();
            // For every run of this Bun: there are no test files, and nobody knows what those of a run will do.
            let builds_library_alone = run_compiled::builds_library_alone();
            let holds_library =
                !is_above_what_is_shared && !run_compiled::is_above_library_of_this_bun();
            // The files that the build does not see and that run beside it.
            let mut files_above = None;
            let mut reached_by_preloads_alone = None;
            if builds_packages_alone {
                entry_points.extend(ctx.preloads.iter().cloned());
                let preloads = find_files_of_preloads(vm, &ctx.preloads);
                let reached = find_files_reached_from(vm, entry_points, &preloads);
                let (of_packages, others) = (reached.of_packages, reached.others);
                reached_by_preloads_alone = Some(reached.by_preloads_alone);
                let only_imported = find_entry_points_only_imported(&of_packages);
                let required = find_entry_points_required(&of_packages);
                if let Some(aot) = ctx.bundler_options.aot.as_mut() {
                    aot.entry_points_only_imported_from_above = only_imported;
                    aot.entry_points_required_from_above = required;
                }
                (entry_points, files_above) = (of_packages, Some(others));
                run_compiled::log_step_of_build("the files of packages are found");
            }
            if builds_library_alone {
                if let Some(aot) = ctx.bundler_options.aot.as_mut() {
                    aot.replaced_by_tests = bun_aot::builtins::everything_that_tests_replace();
                    let is_reference = run_compiled::builds_reference_library();
                    if is_reference {
                        aot.replaced_by_tests.builtins = Default::default();
                    }
                    aot.holds_library_alone = !is_reference;
                    aot.reference_library_image = run_compiled::reference_library_image();
                }
            } else if builds_what_is_shared && !is_above_what_is_shared {
                // The build is told what they replace. The builds above it take over what it ends with.
                let files_above = files_above.as_deref().unwrap_or_default();
                let closed = (ctx.bundler_options.aot.as_ref())
                    .is_some_and(|aot| aot.only_tests_load_code_from_disk);
                let reached_by_preloads_alone = reached_by_preloads_alone.unwrap_or_else(|| {
                    let preloads = find_files_of_preloads(vm, &ctx.preloads);
                    let imported = find_files_imported_by(vm, &preloads);
                    let mut imported = imported.iter();
                    if !closed || imported.all(|path| strings::contains(path, b"/node_modules/")) {
                        return Vec::new();
                    }
                    find_files_reached_from(vm, test_files.clone(), &preloads).by_preloads_alone
                });
                let replaced_by_tests = find_what_tests_replace(
                    vm,
                    &test_files,
                    files_above,
                    &reached_by_preloads_alone,
                    &ctx.preloads,
                    closed,
                    has_window,
                );
                if let Some(aot) = ctx.bundler_options.aot.as_mut() {
                    aot.replaced_by_tests = replaced_by_tests;
                }
                run_compiled::log_step_of_build("what tests replace is found");
            }
            // The test files alone use the layer that they stand on, so it is told what they name.
            let mut stand_in = None;
            let percent_that_goes_lowest = run_compiled::percent_of_files_that_go_lowest();
            let builds_what_computed_imports_reach =
                run_compiled::builds_what_computed_imports_reach();
            let names_what_is_used = env_var::BUN_AOT_TESTS_NAME_WHAT_THEY_USE.get() == Some(true);
            if run_compiled::begins_beside_build_below() {
                begin_beside_build_of_what_computed_imports_reach(vm, ctx, &entry_points);
            }
            if builds_library_alone {
            } else if builds_packages_alone {
                // The files above use the packages, so the layer of the packages is told what they name. A trial behind a word of its own: the preloads
                // and the layer of computed imports use the packages too, and nothing here reads them yet.
                let names_what_is_used =
                    names_what_is_used && run_compiled::packages_are_told_what_is_used();
                if let Some(above) = files_above.as_ref().filter(|_| names_what_is_used) {
                    let above = keep_paths_for_the_build(above.clone());
                    stand_in = Some(make_stand_in_that_names_what_tests_name(
                        vm,
                        &above,
                        StandsIn::ForAllAboveThePackages,
                        &mut entry_points,
                    ));
                    run_compiled::log_step_of_build("what the files above name is found");
                }
            } else if builds_what_computed_imports_reach {
                // Each of them is an entry point: the loader answers a name with an entry point and with no other file of a program.
                entry_points.extend(ctx.preloads.iter().cloned());
                entry_points =
                    find_files_of_packages_that_computed_imports_reach(vm, entry_points).0;
                if entry_points.is_empty() {
                    run_compiled::exit_without_program();
                }
            } else if let Some(percent) = percent_that_goes_lowest {
                // Each of them is an entry point: the programs above import them by name.
                entry_points.extend(ctx.preloads.iter().cloned());
                entry_points = find_lowest_files_reached_from(vm, entry_points, percent);
                let only_imported = find_entry_points_only_imported(&entry_points);
                let required = find_entry_points_required(&entry_points);
                if let Some(aot) = ctx.bundler_options.aot.as_mut() {
                    aot.entry_points_only_imported_from_above = only_imported;
                    aot.entry_points_required_from_above = required;
                }
            } else if builds_what_is_shared {
                let test_files = keep_paths_for_the_build(entry_points);
                entry_points = find_files_imported_by(vm, &test_files);
                let only_imported = find_entry_points_only_imported(&entry_points);
                let required = find_entry_points_required(&entry_points);
                if let Some(aot) = ctx.bundler_options.aot.as_mut() {
                    aot.entry_points_only_imported_from_above = only_imported;
                    aot.entry_points_required_from_above = required;
                }
                if names_what_is_used {
                    stand_in = Some(make_stand_in_that_names_what_tests_name(
                        vm,
                        &test_files,
                        StandsIn::ForTestFiles,
                        &mut entry_points,
                    ));
                }
                entry_points.retain(|path| !run_compiled::is_module_below_test_part(path));
                run_compiled::log_step_of_build("what the test files import is found");
            }
            let file_count = entry_points.len();
            // The preloads may import any file that the test files share, so they go with the highest of those.
            if match builds_what_is_shared {
                true => {
                    !builds_packages_alone
                        && !builds_library_alone
                        && !builds_what_computed_imports_reach
                        && percent_that_goes_lowest.is_none()
                }
                false => !is_above_what_is_shared,
            } {
                entry_points.extend(ctx.preloads.iter().cloned());
            }
            if builds_what_is_shared {
                let spelled = match stand_in.is_none() && holds_library && !builds_library_alone {
                    true => find_library_modules_spelled_from(vm, test_files_and_preloads),
                    false => None,
                };
                if let Some(aot) = ctx.bundler_options.aot.as_mut() {
                    aot.loads_code_from_disk |= stand_in.is_some();
                    aot.host_runs_files_from_disk = stand_in.is_some();
                    // That stand-in asks for every module of Bun's own code that the resolver of this run answers, and the lowest layer holds them.
                    aot.library_runs_compiled_alone = (stand_in.is_none() || builds_packages_alone)
                        && !is_above_what_is_shared
                        && spelled.is_none();
                }
                let stand_in = stand_in.unwrap_or_else(|| {
                    make_stand_in_for_files_from_disk(holds_library, spelled.as_ref())
                });
                if let Some(aot) = ctx.bundler_options.aot.as_mut() {
                    aot.stand_in_for_files_from_disk = Some(stand_in.to_vec());
                }
                entry_points.push(stand_in);
            }
            if has_window {
                entry_points.push(make_stand_in_for_window());
            }
            drop(log_scope);
            run_compiled::start(ctx, entry_points, file_count);
        }

        // Start the debugger before we scan for files
        // But, don't block the main thread waiting if they used --inspect-wait.
        vm.ensure_debugger(false)?;

        // `scanner` borrows these, so they are declared before it.
        let path_ignore_patterns: Vec<bun_glob::Prepared<&[u8]>> = ctx
            .test_options
            .path_ignore_patterns
            .iter()
            .map(|b| bun_glob::Prepared::new(&**b))
            .collect();
        #[cfg(windows)]
        let filter_names_normalized: Vec<Box<[u8]>>;

        let mut scanner = Scanner::init(&vm.transpiler, ctx.positionals.len()).expect("oom");
        scanner.path_ignore_patterns = &path_ignore_patterns;
        let has_relative_path = 'hr: {
            for arg in &ctx.positionals {
                if bun_paths::is_absolute(arg)
                    || strings::starts_with(arg, b"./")
                    || strings::starts_with(arg, b"../")
                    || (cfg!(windows)
                        && (strings::starts_with(arg, b".\\")
                            || strings::starts_with(arg, b"..\\")))
                {
                    break 'hr true;
                }
            }
            false
        };
        if has_relative_path {
            // One of the files is a filepath. Instead of treating the
            // arguments as filters, treat them as filepaths
            let file_or_dirnames = &ctx.positionals[1..];
            for arg in file_or_dirnames {
                match scanner.scan(arg) {
                    Ok(()) => {}
                    Err(scanner::ScanError::OutOfMemory) => bun::out_of_memory(),
                    // don't error if multiple are passed; one might fail
                    // but the others may not
                    Err(scanner::ScanError::DoesNotExist) => {
                        if file_or_dirnames.len() == 1 {
                            if Output::is_ai_agent() {
                                pretty_errorln!(
                                    "Test filter <b>{}<r> had no matches in --cwd={}",
                                    bun_fmt::quote(arg),
                                    bun_fmt::quote(FileSystem::get().top_level_dir())
                                );
                            } else {
                                pretty_errorln!(
                                    "Test filter <b>{}<r> had no matches",
                                    bun_fmt::quote(arg)
                                );
                            }
                            vm.exit_handler.exit_code = 1;
                            vm.is_shutting_down = true;
                            vm.run_with_api_lock_mut(|vm| vm.global_exit());
                        }
                    }
                }
            }
        } else {
            // Treat arguments as filters and scan the codebase
            let filters: &[Box<[u8]>] = ctx.positionals.get(1..).unwrap_or_default();
            #[cfg(windows)]
            let filters: &[Box<[u8]>] = {
                filter_names_normalized = filters
                    .iter()
                    .map(|filter| {
                        let mut normalized = filter.clone();
                        bun_path::resolve_path::posix_to_platform_in_place::<u8>(&mut normalized);
                        normalized
                    })
                    .collect();
                &filter_names_normalized
            };
            scanner.filter_names = filters;

            // Own the joined path in a hoisted buffer and borrow from it.
            let dir_to_scan_owned: Vec<u8>;
            let (dir_to_scan, fits): (&[u8], bool) = 'brk: {
                if !ctx.debug.test_directory.is_empty() {
                    let mut buf = bun_path::path_buffer_pool::get();
                    let Some(joined) =
                        resolve_path::join_abs_string_buf_z_checked::<bun_path::platform::Auto>(
                            scanner.fs().top_level_dir(),
                            &mut buf,
                            &[&ctx.debug.test_directory],
                        )
                    else {
                        break 'brk (&ctx.debug.test_directory[..], false);
                    };
                    dir_to_scan_owned = joined.as_bytes().into();
                    break 'brk (&dir_to_scan_owned[..], true);
                }

                break 'brk (scanner.fs().top_level_dir(), true);
            };

            // A root that's too long for a path buffer can't be opened either.
            let scanned = if fits {
                scanner.scan(dir_to_scan)
            } else {
                Err(scanner::ScanError::DoesNotExist)
            };
            match scanned {
                Ok(()) => {}
                Err(scanner::ScanError::OutOfMemory) => bun::out_of_memory(),
                Err(scanner::ScanError::DoesNotExist) => {
                    if Output::is_ai_agent() {
                        pretty_errorln!(
                            "<red>Failed to scan non-existent root directory for tests:<r> {} in --cwd={}",
                            bun_fmt::quote(dir_to_scan),
                            bun_fmt::quote(FileSystem::get().top_level_dir())
                        );
                    } else {
                        pretty_errorln!(
                            "<red>Failed to scan non-existent root directory for tests:<r> {}",
                            bun_fmt::quote(dir_to_scan)
                        );
                    }
                    vm.exit_handler.exit_code = 1;
                    vm.is_shutting_down = true;
                    vm.run_with_api_lock_mut(|vm| vm.global_exit());
                }
            }
        }

        let mut all_test_files = scanner.take_found_test_files().expect("oom");
        run_compiled::log_step_of_test_run(format_args!(
            "{} test files are found",
            all_test_files.len()
        ));
        // Snapshot the count before `test_files` mutably borrows `all_test_files`
        // so the watcher-enable check below can read it without reborrowing.
        let all_test_files_count = all_test_files.len();
        let search_count = scanner.search_count;
        drop(scanner);

        // When --changed or --shard filters the discovered test files
        // down to zero, the "No tests found!" error path is suppressed
        // and the run exits 0 — an empty shard or an unchanged tree
        // is not a misconfiguration.
        let mut pass_with_no_tests_from_filter = false;
        let mut changed_module_graph_files: Vec<Box<[u8]>> = Vec::new();
        // Defer free handled by Drop.
        let mut test_files: &mut [Interned] = if let Some(changed_since) = &ctx.test_options.changed
        {
            'brk: {
                // If the Scanner found nothing, fall through to the existing
                // "no tests found" error path rather than treating it as a
                // --changed success.
                if all_test_files.is_empty() {
                    break 'brk &mut all_test_files[..];
                }
                let result = match ChangedFilesFilter::filter(
                    &ctx,
                    vm,
                    &mut all_test_files[..],
                    changed_since,
                ) {
                    Ok(r) => r,
                    Err(err) => {
                        Output::err(err, "--changed: unable to determine affected tests", ());
                        Global::exit(1);
                    }
                };
                changed_module_graph_files = result.module_graph_files;
                if result.test_files.is_empty() && result.changed_count == 0 {
                    pretty_error!("<r><d>--changed:<r> no changed files, nothing to run\n");
                    pass_with_no_tests_from_filter = true;
                } else if result.test_files.is_empty() {
                    pretty_error!(
                        "<r><d>--changed:<r> {} changed file{}, but no test files are affected\n",
                        result.changed_count,
                        if result.changed_count == 1 { "" } else { "s" }
                    );
                    pass_with_no_tests_from_filter = true;
                } else if !run_compiled::is_second_process() {
                    pretty_error!(
                        "<r><d>--changed:<r> {} changed file{}, running {}/{} test file{}\n",
                        result.changed_count,
                        if result.changed_count == 1 { "" } else { "s" },
                        result.test_files.len(),
                        result.total_tests,
                        if result.total_tests == 1 { "" } else { "s" }
                    );
                }
                Output::flush();
                break 'brk result.test_files;
            }
        } else {
            &mut all_test_files[..]
        };
        // --shard=M/N: sort the test files for determinism, then keep only
        // every Nth file starting at M-1. This round-robin distribution
        // keeps shards roughly balanced regardless of how many files there
        // are, and is stable across runs and machines as long as the set of
        // test files is the same.
        //
        // Only runs when there are files to shard — if the scanner or
        // --changed already produced an empty list, fall through to the
        // existing "No tests found!" / --changed messaging rather than
        // printing a confusing "running 0/0 test files".
        if let Some(shard) = &ctx.test_options.shard {
            if !test_files.is_empty() {
                let mut write: usize = 0;
                let timings = reporter.timings.as_ref().filter(|t| !t.is_empty());
                let is_compiled =
                    run_compiled::is_requested(ctx) || run_compiled::runs_compiled_code();
                if is_compiled && shard.count > 1 {
                    write = select_shard_by_reach(vm, ctx, test_files, *shard, timings);
                } else if let Some(timings) = timings {
                    write = timings.select_shard(test_files, *shard);
                } else {
                    index_sort::sort_slice_by(test_files, |a, b| {
                        strings::order(a.as_bytes(), b.as_bytes())
                    });
                    let total = test_files.len();
                    for i in 0..total {
                        if i % (shard.count as usize) == (shard.index as usize) - 1 {
                            test_files[write] = test_files[i];
                            write += 1;
                        }
                    }
                }

                if !run_compiled::is_second_process() {
                    pretty_error!(
                        "<r><d>--shard={}/{}:<r> running {}/{} test file{}\n",
                        shard.index,
                        shard.count,
                        write,
                        test_files.len(),
                        if test_files.len() == 1 { "" } else { "s" }
                    );
                }
                Output::flush();

                if write == 0 {
                    // There were test files, but fewer than the shard count so
                    // this shard got none. That's fine — not a "no tests
                    // found" error.
                    pass_with_no_tests_from_filter = true;
                }
                test_files = &mut test_files[0..write];
            }
        }

        // Normally the watcher is only enabled when there are test files to
        // run; `bun test --watch` with nothing matching should still exit.
        // With --changed we always want to keep watching as long as any test
        // files exist, since "nothing changed yet" is the common starting
        // state and editing a source file should kick off a run.
        if !test_files.is_empty()
            || (ctx.test_options.changed.is_some() && all_test_files_count != 0)
        {
            vm.hot_reload = ctx.debug.hot_reload;

            // Install the --changed trigger collector BEFORE the watcher
            // thread starts so a file edit during runAllTests is still
            // recorded. The addFileByPathSlow seeding stays after
            // runAllTests (separate concern; see O_EVTONLY comment
            // below).
            if ctx.test_options.changed.is_some()
                && vm.hot_reload == jsc::virtual_machine::HotReload::Watch
            {
                ChangedFilesFilter::init_watch_trigger();
            }

            match vm.hot_reload {
                jsc::virtual_machine::HotReload::Hot => {
                    // SAFETY: `vm` is the process-lifetime main-thread VM; it
                    // outlives the leaked reloader.
                    unsafe {
                        jsc::hot_reloader::HotReloader::enable_hot_module_reloading(
                            std::ptr::from_mut::<VirtualMachine>(vm),
                            None,
                        );
                    }
                }
                jsc::virtual_machine::HotReload::Watch => {
                    // SAFETY: `vm` is the process-lifetime main-thread VM; it
                    // outlives the leaked reloader.
                    unsafe {
                        jsc::hot_reloader::WatchReloader::enable_hot_module_reloading(
                            std::ptr::from_mut::<VirtualMachine>(vm),
                            None,
                        );
                    }
                    run_compiled::watch_files_of_check(vm);
                }
                _ => {}
            }
        }

        let splits_files = run_compiled::is_requested(ctx)
            && !test_files.is_empty()
            && run_compiled::splits_test_files(ctx, |most| {
                let known = BYTES_THAT_SHARD_REACHES.load(core::sync::atomic::Ordering::Relaxed);
                if known != 0 {
                    return known > most;
                }
                let files = test_files.iter().map(|path| Box::from(&**path));
                let files = files.chain(ctx.preloads.iter().cloned()).collect();
                reach_more_source_than(vm, files, most)
            });
        if splits_files {
            let files = test_files.iter().map(|path| Box::from(&**path));
            *FILES_TO_PLAN_LAYERS_FROM.lock() =
                Some(files.chain(ctx.preloads.iter().cloned()).collect());
        }
        if run_compiled::is_requested(ctx) && !test_files.is_empty() {
            run_compiled::log_form_of_test_run(ctx, test_files.len(), splits_files);
        }
        if !splits_files && run_compiled::is_requested(ctx) && !test_files.is_empty() {
            let runs_files_from_disk = env_var::BUN_AOT_TEST_FILES_FROM_DISK.get() == Some(true)
                && (ctx.bundler_options.aot.as_ref()).is_some_and(|aot| !aot.checks_only);
            if let Some(aot) = ctx.bundler_options.aot.as_mut() {
                aot.test_files_of_run = test_files.iter().map(|path| path.to_vec()).collect();
                aot.preloads_of_test_run = ctx.preloads.iter().map(|path| path.to_vec()).collect();
            }
            let mut entry_points: Vec<Box<[u8]>> = match runs_files_from_disk {
                true => find_files_imported_by(vm, test_files),
                false => test_files.iter().map(|path| Box::from(&**path)).collect(),
            };
            let names_what_tests_use = runs_files_from_disk
                && env_var::BUN_AOT_TESTS_NAME_WHAT_THEY_USE.get() == Some(true);
            let stand_in = names_what_tests_use.then(|| {
                make_stand_in_that_names_what_tests_name(
                    vm,
                    test_files,
                    StandsIn::ForTestFiles,
                    &mut entry_points,
                )
            });
            let file_count = entry_points.len();
            entry_points.extend(ctx.preloads.iter().cloned());
            let files = test_files.iter().map(|path| &**path);
            let has_window = has_file_with_window(files, ctx.test_options.environment);
            if has_window {
                entry_points.push(make_stand_in_for_window());
            }
            if runs_files_from_disk {
                let stand_in = stand_in.unwrap_or_else(|| {
                    let files = test_files.iter().map(|path| Box::from(&**path));
                    let files = files.chain(ctx.preloads.iter().cloned()).collect();
                    let spelled = find_library_modules_spelled_from(vm, files);
                    make_stand_in_for_files_from_disk(true, spelled.as_ref())
                });
                if let Some(aot) = ctx.bundler_options.aot.as_mut() {
                    aot.stand_in_for_files_from_disk = Some(stand_in.to_vec());
                }
                entry_points.push(stand_in);
            }
            if (ctx.bundler_options.aot.as_ref()).is_some_and(|aot| !aot.checks_only) {
                let closed = (ctx.bundler_options.aot.as_ref())
                    .is_some_and(|aot| aot.only_tests_load_code_from_disk);
                let replaced_by_tests = find_what_tests_replace(
                    vm,
                    test_files,
                    &[],
                    &[],
                    &ctx.preloads,
                    closed,
                    has_window,
                );
                if let Some(aot) = ctx.bundler_options.aot.as_mut() {
                    aot.loads_code_from_disk |= runs_files_from_disk;
                    aot.host_runs_files_from_disk = names_what_tests_use;
                    if runs_files_from_disk {
                        aot.main_modules_beside_entry_points =
                            test_files.iter().map(|path| path.to_vec()).collect();
                    }
                    aot.replaced_by_tests = replaced_by_tests;
                }
            }
            // The workers of --parallel learn which files are refused from the compiled program alone.
            let aot = ctx.bundler_options.aot.as_ref();
            let independent_count = match ctx.test_options.parallel {
                0 => file_count,
                _ if aot.is_some_and(|aot| !aot.checks_only) => file_count,
                _ => 0,
            };
            run_compiled::start(ctx, entry_points, independent_count);
        }

        // After the file watcher is enabled: see `watching`.
        let has_type_errors = ctx.runtime_options.check && {
            use crate::cli::check_command::{EntryPoint, check_before, watching};
            let paths = test_files.iter().map(|path| EntryPoint::file(path));
            !check_before(&paths.collect::<Vec<_>>(), watching(vm))
        };
        if has_type_errors {
            // No test is run.
            if !vm.is_watcher_enabled() {
                Global::exit(1);
            }
            vm.run_with_api_lock_mut(Self::run_event_loop_for_watch);
        }

        let mut coverage_options: CodeCoverageOptions = ctx.test_options.coverage.clone();
        let mut ran_parallel = false;
        let mut left_by_workers = ParallelRunner::LeftByWorkers::default();

        if !test_files.is_empty() {
            // Randomize the order of test files if --randomize flag is set
            if let Some(mut rand) = random_instance {
                // `std.Random.shuffle` → Fisher–Yates over `DefaultPrng::next_u64`.
                let n = test_files.len();
                if n > 1 {
                    let mut i = n - 1;
                    while i > 0 {
                        // Unbiased range via 128-bit mul (Lemire).
                        let j = ((rand.next_u64() as u128 * (i as u128 + 1)) >> 64) as usize;
                        test_files.swap(i, j);
                        i -= 1;
                    }
                }
            }

            if ctx.test_options.parallel > 0 || splits_files {
                run_compiled::log_step_of_test_run(format_args!(
                    "{} test files are to run",
                    test_files.len()
                ));
                ran_parallel = ParallelRunner::run_as_coordinator(
                    &mut reporter,
                    vm,
                    test_files,
                    &mut *ctx,
                    &mut coverage_options,
                    splits_files,
                    &mut left_by_workers,
                )?;
                if let Some(code) = left_by_workers.exit_code {
                    vm.exit_handler.exit_code = code;
                }
                if left_by_workers.bailed_out {
                    reporter.bail_out(vm);
                }
            } else {
                // SAFETY: `vm.transpiler.env` is the process-lifetime DotEnv loader pointer.
                ParallelRunner::set_ids_without_workers(unsafe { &mut *vm.transpiler.env });
            }
            if !ran_parallel {
                crate::run_command::start_profilers(vm, ctx);
                Self::run_all_tests(&mut reporter, vm, test_files);
            }
        }

        // With --changed, only a subset of test files (possibly none) runs,
        // so the module loader won't naturally add every source file to the
        // watcher. Seed it from the module graph so editing any local source
        // file — including files only reachable from tests that were
        // filtered out — still triggers a restart under --watch.
        //
        // This must happen AFTER runAllTests: during the run the module
        // loader registers loaded files with a readable fd, which
        // RuntimeTranspilerStore reuses on the next load. On macOS
        // addFileByPathSlow opens with O_EVTONLY (not readable); seeding
        // first would hand that fd to the transpiler. Seeding after means
        // loaded files are already present (indexOf early-returns) and only
        // the never-loaded filtered-out subgraph gets an O_EVTONLY entry,
        // which the transpiler never touches. The test harness syncs on the
        // "Ran N tests" summary (printed after this), so seeding completes
        // before the next file edit.
        if ctx.test_options.changed.is_some() && vm.is_watcher_enabled() {
            // SAFETY: `bun_watcher` is the `*mut ImportWatcher` set by
            // `enable_hot_module_reloading`; non-null because
            // `is_watcher_enabled()` checked it.
            let watcher =
                unsafe { &mut *vm.bun_watcher.cast::<jsc::hot_reloader::ImportWatcher>() };
            for path in &changed_module_graph_files {
                let _ = watcher.add_file_by_path_slow(path);
            }
        }

        let runner = &mut reporter.jest;
        let write_snapshots_success = runner.snapshots.write_inline_snapshots(&runner.files)?
            && !left_by_workers.failed_to_write_inline_snapshots;
        runner.snapshots.write_snapshot_file(&runner.files)?;
        let mut write_coverage_success = true;
        if reporter.summary().pass > 20
            && !Output::is_ai_agent()
            && !reporter.reporters.dots
            && !reporter.reporters.only_failures
        {
            if reporter.summary().skip > 0 {
                pretty_error!("\n<r><d>{} tests skipped:<r>\n", reporter.summary().skip);
                Output::flush();

                let error_writer = Output::error_writer();
                let _ = error_writer.write_all(&reporter.skips_to_repeat_buf);
            }

            if reporter.summary().todo > 0 {
                if reporter.summary().skip > 0 {
                    pretty_error!("\n");
                }

                pretty_error!("\n<r><d>{} tests todo:<r>\n", reporter.summary().todo);
                Output::flush();

                let error_writer = Output::error_writer();
                let _ = error_writer.write_all(&reporter.todos_to_repeat_buf);
            }

            if reporter.summary().fail > 0 {
                if reporter.summary().skip > 0 || reporter.summary().todo > 0 {
                    pretty_error!("\n");
                }

                pretty_error!("\n<r><d>{} tests failed:<r>\n", reporter.summary().fail);
                Output::flush();

                let error_writer = Output::error_writer();
                let _ = error_writer.write_all(&reporter.failures_to_repeat_buf);
            }
        }

        Output::flush();

        let mut failed_to_find_any_tests = false;

        if test_files.is_empty() && !pass_with_no_tests_from_filter {
            failed_to_find_any_tests = true;

            // "bun test" - positionals[0] == "test"
            // Therefore positionals starts at [1].
            if ctx.positionals.len() < 2 {
                if Output::is_ai_agent() {
                    // Be very clear to ai.
                    Output::err_generic(
                        "0 test files matching **{{.test,.spec,_test_,_spec_}}.{{js,ts,jsx,tsx}} in --cwd={}",
                        (bun_fmt::quote(FileSystem::get().top_level_dir()),),
                    );
                } else {
                    // Be friendlier to humans.
                    pretty_errorln!(
                        "<yellow>No tests found!<r>\n\nTests need \".test\", \"_test_\", \".spec\" or \"_spec_\" in the filename <d>(ex: \"MyApp.test.ts\")<r>\n"
                    );
                }
            } else {
                if Output::is_ai_agent() {
                    pretty_errorln!(
                        "<yellow>The following filters did not match any test files in --cwd={}:<r>",
                        bun_fmt::quote(FileSystem::get().top_level_dir())
                    );
                } else {
                    pretty_errorln!(
                        "<yellow>The following filters did not match any test files:<r>"
                    );
                }
                let mut has_file_like: Option<usize> = None;
                for (i, filter) in ctx.positionals[1..]
                    .iter()
                    .enumerate()
                    .map(|(i, f)| (i + 1, f))
                {
                    pretty_error!(" {}", bstr::BStr::new(filter));

                    if has_file_like.is_none()
                        && (strings::ends_with(filter, b".ts")
                            || strings::ends_with(filter, b".tsx")
                            || strings::ends_with(filter, b".js")
                            || strings::ends_with(filter, b".jsx"))
                    {
                        has_file_like = Some(i);
                    }
                }
                if search_count > 0 {
                    pretty_error!("\n{} files were searched ", search_count);
                    Output::print_start_end(ctx.start_time, bun::time::nano_timestamp());
                }

                pretty_errorln!(
                    "\n\n<blue>note<r><d>:<r> Tests need \".test\", \"_test_\", \".spec\" or \"_spec_\" in the filename <d>(ex: \"MyApp.test.ts\")<r>"
                );

                // print a helpful note
                if let Some(i) = has_file_like {
                    pretty_errorln!(
                        "<blue>note<r><d>:<r> To treat the \"{}\" filter as a path, run \"bun test ./{}\"<r>",
                        bstr::BStr::new(&ctx.positionals[i]),
                        bstr::BStr::new(&ctx.positionals[i]),
                    );
                }
            }
            if !Output::is_ai_agent() {
                pretty_error!(
                    "\nLearn more about bun test: <magenta>https://bun.com/docs/cli/test<r>",
                );
            }
        } else {
            pretty_error!("\n");

            if coverage_options.enabled && !ran_parallel {
                write_coverage_success = reporter.generate_code_coverage(vm, &mut coverage_options);
            }

            // `Summary` is `Copy`; take a value snapshot so the `&mut` from
            // `reporter.summary()` doesn't span the whole printing block and
            // conflict with the `reporter.jest.*` reads below.
            let summary: Summary = *reporter.summary();
            let did_label_filter_out_all_tests = summary.did_label_filter_out_all_tests()
                && reporter.jest.unhandled_errors_between_tests == 0;

            if !did_label_filter_out_all_tests {
                struct DotIndenter {
                    indent: bool,
                }

                impl core::fmt::Display for DotIndenter {
                    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                        if self.indent {
                            f.write_str(" ")?;
                        }
                        Ok(())
                    }
                }

                let indenter = DotIndenter {
                    indent: !ctx.test_options.reporters.dots,
                };
                if !indenter.indent {
                    pretty_error!("\n");
                }

                // Display the random seed if tests were randomized
                if random_instance.is_some() || summary.shuffled > 0 {
                    pretty_error!("{}<r>--seed={}<r>\n", &indenter, seed);
                }

                if summary.pass > 0 {
                    pretty_error!("<r><green>");
                }

                pretty_error!("{}{:5>} pass<r>\n", &indenter, summary.pass);

                if summary.skip > 0 {
                    pretty_error!("{}<r><yellow>{:5>} skip<r>\n", &indenter, summary.skip);
                } else if summary.skipped_because_label > 0 {
                    pretty_error!(
                        "{}<r><d>{:5>} filtered out<r>\n",
                        &indenter,
                        summary.skipped_because_label
                    );
                }

                if summary.todo > 0 {
                    pretty_error!("{}<r><magenta>{:5>} todo<r>\n", &indenter, summary.todo);
                }

                if summary.fail > 0 {
                    pretty_error!("<r><red>");
                } else {
                    pretty_error!("<r><d>");
                }

                pretty_error!("{}{:5>} fail<r>\n", &indenter, summary.fail);
                if reporter.jest.unhandled_errors_between_tests > 0 {
                    pretty_error!(
                        "{}<r><red>{:5>} error{}<r>\n",
                        &indenter,
                        reporter.jest.unhandled_errors_between_tests,
                        if reporter.jest.unhandled_errors_between_tests > 1 {
                            "s"
                        } else {
                            ""
                        }
                    );
                }

                let mut print_expect_calls = summary.expectations > 0;
                if reporter.jest.snapshots.total > 0 {
                    let passed = reporter.jest.snapshots.passed;
                    let failed = reporter.jest.snapshots.failed;
                    let added = reporter.jest.snapshots.added;

                    let mut first = true;
                    if print_expect_calls && added == 0 && failed == 0 {
                        print_expect_calls = false;
                        pretty_error!(
                            "{}{:5>} snapshots, {:5>} expect() calls",
                            &indenter,
                            reporter.jest.snapshots.total,
                            summary.expectations
                        );
                    } else {
                        pretty_error!("<d>snapshots:<r> ");

                        if passed > 0 {
                            pretty_error!("<d>{} passed<r>", passed);
                            first = false;
                        }

                        if added > 0 {
                            if first {
                                first = false;
                                pretty_error!("<b>+{} added<r>", added);
                            } else {
                                pretty_error!("<b>, {} added<r>", added);
                            }
                        }

                        if failed > 0 {
                            if first {
                                pretty_error!("<red>{} failed<r>", failed);
                            } else {
                                pretty_error!(", <red>{} failed<r>", failed);
                            }
                        }
                    }

                    pretty_error!("\n");
                }

                if print_expect_calls {
                    pretty_error!("{}{:5>} expect() calls\n", &indenter, summary.expectations);
                }

                reporter.print_summary();
            } else {
                pretty_error!(
                    "<red>error<r><d>:<r> regex <b>{}<r> matched 0 tests. Searched {} file{} (skipping {} test{}) ",
                    bun_fmt::quote(ctx.test_options.test_filter_pattern.as_ref().unwrap()),
                    summary.files,
                    if summary.files == 1 { "" } else { "s" },
                    summary.skipped_because_label,
                    if summary.skipped_because_label == 1 {
                        ""
                    } else {
                        "s"
                    },
                );
                Output::print_start_end(ctx.start_time, bun::time::nano_timestamp());
            }
        }

        pretty_error!("\n");
        let (refused_loads, refused): (Vec<Vec<u8>>, Vec<Vec<u8>>) =
            (run_compiled::refused_changes().into_iter())
                .partition(|refusal| refusal.starts_with(run_compiled::REFUSED_LOAD));
        if !refused_loads.is_empty() {
            pretty_error!(
                "<yellow>{} load{} of code that wasn't compiled<r> failed during this run, caught or not. An executable refuses them too, unless the file is built into it. Import the file by a constant path, or add --aot-allow-code-from-disk:\n",
                refused_loads.len(),
                if refused_loads.len() == 1 { "" } else { "s" }
            );
            for refusal in &refused_loads {
                pretty_error!("  {}\n", bstr::BStr::new(refusal));
            }
            for (asker, importer) in run_compiled::find_why_askers_are_of_product(&refused_loads) {
                pretty_error!(
                    "  <d>{} is part of your program: {} imports it, and that's no file of your tests.<r>\n",
                    bstr::BStr::new(&asker),
                    bstr::BStr::new(&importer)
                );
            }
        }
        let (unreached, refused): (Vec<Vec<u8>>, Vec<Vec<u8>>) =
            (refused.into_iter()).partition(|line| line.starts_with(run_compiled::UNREACHED_FILE));
        if !unreached.is_empty() {
            pretty_error!(
                "<yellow>{} load{} of a compiled file by a computed path<r> failed during this run, caught or not. The build saw no import() or require() of a computed path, and it can't see code from a string, as in eval() or new Function(). An executable refuses them too. Import the file by a constant path:\n",
                unreached.len(),
                if unreached.len() == 1 { "" } else { "s" }
            );
            for refusal in &unreached {
                pretty_error!("  {}\n", bstr::BStr::new(refusal));
            }
        }
        let (addons, refused): (Vec<Vec<u8>>, Vec<Vec<u8>>) =
            (refused.into_iter()).partition(|line| line.starts_with(run_compiled::LOADED_ADDON));
        if !addons.is_empty() {
            pretty_error!(
                "<yellow>{} native addon{} that the build didn't find<r> loaded from disk during this run. An executable holds one only if it's given the file as an entry point:\n",
                addons.len(),
                if addons.len() == 1 { "" } else { "s" }
            );
            for addon in &addons {
                pretty_error!("  {}\n", bstr::BStr::new(addon));
            }
        }
        let (missing_exports, refused): (Vec<Vec<u8>>, Vec<Vec<u8>>) =
            (refused.into_iter()).partition(|line| line.starts_with(run_compiled::MISSING_EXPORT));
        if !missing_exports.is_empty() {
            pretty_error!(
                "<yellow>{} import{} of a name that the build left out<r> failed during this run, caught or not. Code that was loaded from disk asked a compiled module for it. Unless the name is misspelled, this is a bug in Bun:\n",
                missing_exports.len(),
                if missing_exports.len() == 1 { "" } else { "s" }
            );
            for line in &missing_exports {
                pretty_error!(
                    "  {}\n",
                    bstr::BStr::new(&line[run_compiled::MISSING_EXPORT.len()..])
                );
            }
        }
        if !refused.is_empty() {
            pretty_error!(
                "<yellow>{} write{} to read-only built-ins<r> failed during this run, caught or not. Code that continued after one may have left its work half done:\n",
                refused.len(),
                if refused.len() == 1 { "" } else { "s" }
            );
            for refusal in &refused {
                pretty_error!("  {}\n", bstr::BStr::new(refusal));
            }
            pretty_error!(
                "<d>Only the files of your tests can replace a built-in. To make a helper one of them, move it into a test file's folder or below it, import from \"bun:test\" in it, or name it as a preload.<r>\n",
            );
        }
        Output::flush();

        reporter.write_junit_report_if_needed();
        if !test_files.is_empty() || ctx.test_options.shard.is_some() {
            reporter.write_timings_if_needed();
        }

        if vm.hot_reload == jsc::virtual_machine::HotReload::Watch {
            vm.run_with_api_lock_mut(Self::run_event_loop_for_watch);
        }
        let summary = reporter.summary();

        let should_fail_on_no_tests = !ctx.test_options.pass_with_no_tests
            && (failed_to_find_any_tests || summary.did_label_filter_out_all_tests());
        if should_fail_on_no_tests
            || summary.fail > 0
            || (coverage_options.enabled
                && coverage_options.fractions.failing
                && coverage_options.fail_on_low_coverage)
            || !write_snapshots_success
            || !write_coverage_success
            || reporter.jest.unhandled_errors_between_tests > 0
        {
            vm.exit_handler.exit_code = 1;
        }
        vm.exit_handler.skip_exit_listeners = skip_exit_listeners(&reporter);
        vm.exit_handler.requested = exit_is_requested();
        // Must precede the GC-root release below: exit listeners are user JS and may touch still-live state.
        vm.run_with_api_lock_mut(VirtualMachine::on_exit);
        // on_exit() already set is_shutting_down; global_exit() asserts it.
        // Release `bun:test` GC roots before `global_exit()` so
        // `Zig__GlobalObject__destructOnExit()`'s `collectNow()` can reach the closures they pin
        // (preload hooks, per-file describe/test callbacks). Clear `RUNNER`
        // before dropping `reporter` so finalizers running inside the GC can't
        // observe a dangling `TestRunner`.
        reporter.jest.bun_test_root.deinit_for_exit();
        // SAFETY: `RUNNER` is a `RacyCell` touched only from the single JS thread;
        // no concurrent reader exists on this shutdown path.
        unsafe {
            jest::Jest::RUNNER.write(None);
        }
        drop(reporter);
        // `global_exit()` does not return, so nothing is dropped after it.
        drop(all_test_files);
        vm.run_with_api_lock_mut(|vm| vm.global_exit());
        Ok(())
    }

    fn run_event_loop_for_watch(vm: &mut VirtualMachine) {
        vm.event_loop_ref().tick_possibly_forever();

        loop {
            while vm.is_event_loop_alive() {
                vm.tick();
                vm.event_loop_ref().auto_tick_active();
            }

            vm.event_loop_ref().tick_possibly_forever();
        }
    }

    pub(crate) fn run_all_tests(
        reporter_: &mut CommandLineReporter,
        vm_: &mut VirtualMachine,
        files_: &[Interned],
    ) {
        struct Context<'a> {
            reporter: &'a mut CommandLineReporter,
            vm: &'a mut VirtualMachine,
            files: &'a [Interned],
        }
        impl<'a> Context<'a> {
            fn begin(&mut self) {
                let reporter = &mut *self.reporter;
                let vm = &mut *self.vm;
                let files = self.files;
                debug_assert!(!files.is_empty());

                let isolate = vm.test_isolation_enabled;

                if files.len() > 1 {
                    for (i, file_name) in files[0..files.len() - 1].iter().enumerate() {
                        let started = bun::time::milli_timestamp();
                        if let Err(err) = TestCommand::run(
                            reporter,
                            vm,
                            file_name.as_bytes(),
                            bun_test::FirstLast {
                                first: isolate || i == 0,
                                last: isolate,
                            },
                        ) {
                            handle_top_level_test_error_before_javascript_start(&err);
                        }
                        if let Some(t) = reporter.timings.as_mut() {
                            t.record_since(file_name.as_bytes(), started);
                        }
                        reporter.jest.default_timeout_override = u32::MAX;
                        Global::mimalloc_cleanup(false);
                        if isolate {
                            crate::jsc_hooks::stop_active_handles_for_test_isolation(vm);
                            vm.swap_global_for_test_isolation();
                            reporter
                                .jest
                                .bun_test_root
                                .reset_hook_scope_for_test_isolation();
                            crate::test_runner::Expect::reset_for_test_isolation(vm.global());
                        }
                    }
                }

                let last = files[files.len() - 1];
                let started = bun::time::milli_timestamp();
                if let Err(err) = TestCommand::run(
                    reporter,
                    vm,
                    last.as_bytes(),
                    bun_test::FirstLast {
                        first: isolate || files.len() == 1,
                        last: true,
                    },
                ) {
                    handle_top_level_test_error_before_javascript_start(&err);
                }
                if let Some(t) = reporter.timings.as_mut() {
                    t.record_since(last.as_bytes(), started);
                }
            }
        }

        // No MimallocArena is wired through `vm.arena` on this serial run
        // path; the parallel worker path in runner.rs does wire one.
        // Reintroduce here if it shows up in profiles.
        vm_.event_loop_ref().ensure_waker();
        vm_.run_with_api_lock_mut(|vm| {
            Context {
                reporter: reporter_,
                vm,
                files: files_,
            }
            .begin()
        });
    }

    // Not inlined: the bytes of the resolver's result that nothing wrote are old stack, and the GC scans `run`'s frame while the file runs.
    #[inline(never)]
    fn resolve_test_file(
        vm: &mut VirtualMachine,
        file_name: &[u8],
    ) -> crate::Result<&'static [u8]> {
        let dot_slash = core::cell::OnceCell::new();
        let resolution = vm.transpiler.resolve_entry_point(file_name, &dot_slash)?;
        // `append_slice` interns into the process-static `FilenameStore` and
        // returns `&'static [u8]`.
        Ok(FileSystem::get()
            .filename_store
            .append_slice(resolution.path_pair.primary.text)
            .expect("oom"))
    }

    fn never_settled(
        global: &jsc::JSGlobalObject,
        what: &str,
        file_path: &[u8],
    ) -> *mut jsc::JSInternalPromise {
        let rejected = jsc::JSPromise::rejected_promise(
            global,
            global.create_error_instance(format_args!(
                "{what} never settled in {}\nnote: {}",
                bun_fmt::quote(file_path),
                TopLevelWaitError::NothingLeft,
            )),
        );
        rejected.set_handled();
        std::ptr::from_mut(rejected)
    }

    fn undo_module_mocks(
        vm: &VirtualMachine,
        global: &jsc::JSGlobalObject,
        file_path: &[u8],
        next_load_shares_global: bool,
    ) {
        unsafe extern "C" {
            safe fn JSMock__replaceModuleOfTestFile(
                global: &jsc::JSGlobalObject,
                path: &bun::String,
            );
        }
        bun_jsc::cpp::JSMock__forgetPendingModulePatches(global);
        bun_jsc::cpp::JSMock__undoModuleMocksOfTestFile(global, next_load_shares_global);
        if !next_load_shares_global {
            return;
        }
        // Wait for in-flight modules to load and be evicted, or the next file would get them with this file's mocks.
        // Uses the hook timeout. A leaked timer or server keeps the loop alive, so a load that never settles would
        // block here forever.
        let timeout = jest::Jest::runner().map_or(0, |runner| runner.default_timeout_ms);
        let real_time = bun::TimespecMockMode::ForceRealTime;
        let deadline = bun::Timespec::ms_from_now(real_time, timeout.into());
        let waited = vm.event_loop_ref().wait_at_top_level(|| {
            !bun_jsc::cpp::JSMock__hasModulesToEvict(global)
                || (timeout != 0 && bun::Timespec::now(real_time).greater(&deadline))
        });
        if waited != Err(TopLevelWaitError::Stopped)
            && bun_jsc::cpp::JSMock__hasModulesToEvict(global)
        {
            // The next file would hang on them and take the blame.
            drop(bun_jsc::cpp::Bun__evictUnfinishedModules(global));
        }
        // Also evict the test file: it holds its own copies of the mock's importers.
        JSMock__replaceModuleOfTestFile(global, &bun::StringView::from_bytes(file_path));
    }

    /// Returns a description for the error, and the step's identity so the caller can tell if the runner moved on.
    fn what_runner_waits_for(
        buntest: &bun_test::BunTest,
    ) -> (&'static str, Option<(*const (), i64)>) {
        match buntest.get_current_state_data() {
            bun_test::RefDataValue::Collection { active_scope } => (
                "A describe() callback",
                Some((active_scope.as_ptr().cast_const().cast(), 0)),
            ),
            bun_test::RefDataValue::Execution {
                entry_data: Some(entry),
                ..
            } => (
                "A test or hook with no timeout",
                Some((entry.entry, i64::from(entry.attempt))),
            ),
            bun_test::RefDataValue::Done => ("An un-awaited matcher's promise", None),
            _ => ("A test or hook with no timeout", None),
        }
    }

    #[optimize(size)]
    pub(crate) fn run(
        reporter: &mut CommandLineReporter,
        vm: &mut VirtualMachine,
        file_name: &[u8],
        first_last: bun_test::FirstLast,
    ) -> crate::Result<()> {
        let _print_log = PrintLogAfterFile(vm.log);
        let restore_only = RestoreOnlyAfterFile {
            only: reporter.jest.only,
            reporter,
        };
        let reporter: &mut CommandLineReporter = restore_only.reporter;

        let file_path = Self::resolve_test_file(vm, file_name)?;
        vm.clear_entry_point()?;
        vm.enter_module_graph_for_test_isolation()?;

        run_compiled::will_run_test_file(resolve_path::relative(
            FileSystem::get().top_level_dir(),
            file_path,
        ));
        let file_id = jest::Jest::runner()
            .unwrap()
            .get_or_put_file(file_path)
            .file_id;

        // In Github Actions, append a special prefix that will group
        // subsequent log lines into a collapsable group.
        // https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#grouping-log-lines
        let file_prefix: &[u8] = if Output::is_github_action() {
            b"::group::"
        } else {
            b""
        };

        let repeat_count = reporter.repeat_count;
        let mut repeat_index: u32 = 0;
        vm.on_unhandled_rejection_ctx = None;
        vm.on_unhandled_rejection = jest::on_unhandled_rejection::on_unhandled_rejection;
        vm.is_running_vitest_entry = false;
        let mut environment =
            Environment::of_file(file_path, reporter.jest.test_options.environment);

        while repeat_index < repeat_count {
            // Clear the module cache before re-running (except for the first run)
            if repeat_index > 0 {
                vm.clear_entry_point()?;
                let key = jsc::compiled_program::entry_module_key(file_path);
                vm.global()
                    .delete_module_registry_entry(&EncodedSlice::from_bytes(key))?;
                jsc::compiled_program::will_run_entry_point_again(vm.global(), key);
            }
            if repeat_index > 0 {
                // Reset per-test snapshot counters so rerun N matches the same
                // snapshot keys as run 1 instead of looking for "test name 2", etc.
                reporter.jest.snapshots.reset_counts();
            }

            let bun_test_root = &mut jest::Jest::runner().unwrap().bun_test_root;
            // Determine if this file should run tests concurrently based on glob pattern
            let should_run_concurrent = reporter.jest.should_file_run_concurrently(file_id);
            bun_test_root.enter_file(file_id, reporter, should_run_concurrent, first_last);
            let bun_test_root_ptr: *mut bun_test::BunTestRoot = bun_test_root;
            let global = vm.global();
            // `--isolate` swaps the global after the last repeat.
            let next_load_shares_global = !vm.test_isolation_enabled
                || vm.test_isolation_state.shares_global
                || repeat_index + 1 < repeat_count;
            let _entered_file = EnteredFile {
                bun_test_root: bun_test_root_ptr,
                global,
                next_load_shares_global,
            };

            // Recompute on every repeat because the reporters overwrite `relative`'s buffer while the file runs.
            let file_title = resolve_path::relative(FileSystem::get().top_level_dir(), file_path);
            reporter.jest.current_file.set(
                file_title,
                file_prefix,
                repeat_count,
                repeat_index,
                reporter.worker_ipc_file_idx.is_some() && !reporter.worker_stands_for_one_process,
                &reporter.reporters,
            );

            bun_output::scoped_log!(
                bun_test,
                "loadEntryPointForTestRunner(\"{}\")",
                bstr::BStr::new(file_path)
            );
            // Bun.jsc.Jest.bun_test.debug.group.log → local declare_scope!(bun_test).

            if let Some(junit) = reporter.reporters.junit.as_mut() {
                junit.file_start_ns = bun::Timespec::now(bun::TimespecMockMode::ForceRealTime).ns();
                junit.file_start_unix_ms = bun::time::milli_timestamp();
            }
            // need to wake up so autoTick() doesn't wait for 16-100ms after loading the entrypoint
            vm.wakeup();
            let mut promise = match run_compiled::is_refused(file_path) {
                true => None,
                false => Some(environment.load_entry_point(vm, file_path)?),
            };
            // Only count the file once, not once per repeat
            if repeat_index == 0 {
                reporter.summary().files += 1;
            }

            if promise.is_some_and(|promise| {
                jsc::JSInternalPromise::opaque_mut(promise).status()
                    != jsc::js_promise::Status::Rejected
            }) {
                vm.event_loop_ref().tick();

                // Tests start after top-level mock.module() calls with a pending factory have patched their module.
                let patched = vm
                    .event_loop_ref()
                    .wait_at_top_level(|| !bun_jsc::cpp::JSMock__hasPendingModulePatches(global));
                if patched == Err(TopLevelWaitError::NothingLeft) {
                    // As in Vitest, a vi.mock() or vi.doMock() factory may wait for something a test does.
                    bun_jsc::cpp::JSMock__forgetPendingModulePatchesOfVitest(global);
                    if bun_jsc::cpp::JSMock__hasPendingModulePatches(global) {
                        promise = Some(Self::never_settled(
                            global,
                            "A mock.module() factory",
                            file_path,
                        ));
                    }
                }
            }

            // S012: `JSInternalPromise` is an `opaque_ffi!` ZST — safe `*mut → &mut` deref.
            let failed_to_load = promise.is_none_or(|promise| {
                jsc::JSInternalPromise::opaque_mut(promise).status()
                    == jsc::js_promise::Status::Rejected
            });
            match promise {
                Some(promise) if failed_to_load => {
                    // `vm.global()` returns `&'static`, decoupled from `vm`'s borrow so
                    // `unhandled_rejection(&mut self, ...)` can reborrow.
                    let global = vm.global();
                    let p = jsc::JSInternalPromise::opaque_mut(promise);
                    let (result, promise_js) = (p.result(global.vm()), p.to_js());
                    vm.unhandled_rejection(global, result, promise_js);
                }
                Some(_) => {}
                None => {
                    reporter.jest.current_file.print_if_needed();
                    pretty_error!(
                        "<r><red>error<r>: bun test --aot does not run this file: it can't be compiled, or it imports a file that can't be (see above)\n"
                    );
                    Output::flush();
                    // As plain counts a file that does not load: an error between tests.
                    reporter.jest.unhandled_errors_between_tests += 1;
                    let said = run_compiled::find_what_build_said_of_refused_file(file_path);
                    let said = said.unwrap_or_default();
                    let end = strings::index_of_char_usize(said, b'\n').unwrap_or(said.len());
                    reporter.record_unhandled_error(
                        file_id,
                        TestFailure {
                            name: b"BuildMessage".to_vec(),
                            message: said[..end].to_vec(),
                            body: said.get(end + 1..).unwrap_or_default().to_vec(),
                            uncaught: false,
                        },
                    );
                }
            }

            'blk: {
                // Check if bun_test is available and has tests to run
                let Some(buntest_strong) = bun_test_root.clone_active_file() else {
                    debug_assert!(false);
                    break 'blk;
                };
                let buntest = buntest_strong.get();
                buntest.is_loading = false;
                // Skips this file's tests, but preload hooks due with this file still run.
                buntest.collection.root_scope.failed |= failed_to_load;

                // Automatically execute bun_test tests
                if buntest.result_queue.readable_length() == 0 {
                    buntest.add_result(bun_test::ResultMsg::Start);
                }
                // `BunTestPtr` is `Rc<BunTestCell>`; clone (refcount++) so the
                // local `buntest_strong` survives for the post-run drain loop and
                // the explicit `drop` below.
                bun_test::BunTest::run(&buntest_strong, vm.global())?;

                // Process event loop while bun_test tests are running
                vm.event_loop_ref().tick();

                let mut prev_unhandled_count = vm.unhandled_error_counter;
                while buntest.phase != bun_test::Phase::Done {
                    // `RunTestsTask` leaves results queued when it fires in an event loop nested under JS.
                    if buntest.result_queue.readable_length() > 0 {
                        bun_test::BunTest::run_next_tick(
                            &std::rc::Rc::downgrade(&buntest_strong),
                            global,
                            bun_test::ResultMsg::Start,
                        );
                    }
                    if buntest.wants_wakeup {
                        buntest.wants_wakeup = false;
                        vm.wakeup();
                    }
                    if buntest.timer.state != crate::timer::EventLoopTimerState::ACTIVE
                        && !vm.has_work_left()
                    {
                        let (what, waits_for) = Self::what_runner_waits_for(buntest);
                        let p = jsc::JSPromise::opaque_mut(Self::never_settled(
                            global, what, file_path,
                        ));
                        vm.unhandled_rejection(global, p.result(global.vm()), p.to_js());
                        vm.event_loop_ref().tick();
                        // The error ends a describe() or a test. Anything else stays stuck, so abandon the file.
                        if waits_for.is_none()
                            || waits_for == Self::what_runner_waits_for(buntest).1
                        {
                            break;
                        }
                        continue;
                    }
                    vm.event_loop_ref().auto_tick_asleep();
                    if buntest.phase == bun_test::Phase::Done {
                        break;
                    }
                    vm.event_loop_ref().tick();

                    while prev_unhandled_count < vm.unhandled_error_counter {
                        let _ = vm.global().handle_rejected_promises();
                        prev_unhandled_count = vm.unhandled_error_counter;
                    }
                }

                let el = vm.event_loop();
                // SAFETY: el is the VM-owned event loop; vm is passed back as *mut.
                unsafe { (*el).tick_immediate_tasks(vm) };

                // Node parity: a node test file exits only when its loop drains.
                // on_before_exit() drains and dispatches 'beforeExit' like `bun run`;
                // it early-returns when unhandled_error_counter > 0, which is fine
                // here since such a file already failed. Opt-in; one file per process.
                if should_drain_event_loop() {
                    vm.on_before_exit();
                }
                reporter.jest.snapshots.remove_obsolete(buntest);
                drop(buntest_strong);
            }

            if failed_to_load {
                reporter.summary().fail += 1;
                // It has no test to list under "N tests failed:".
                if !reporter.reporters.dots && !reporter.reporters.only_failures {
                    let failures = &mut reporter.failures_to_repeat_buf;
                    failures.extend_from_slice(&fmt_status_text_line(
                        bun_test::Execution::Result::Fail,
                        Output::enable_ansi_colors_stderr(),
                    ));
                    let top_level_dir = FileSystem::instance().top_level_dir();
                    let title = resolve_path::relative(top_level_dir, file_path);
                    let _ = writeln!(failures, " {}", bstr::BStr::new(title));
                }

                if reporter.jest.bail == reporter.summary().fail {
                    // This never returns, so `EnteredFile`'s `Drop` doesn't run.
                    reporter.bail_out(vm);
                }
            }

            crate::test_runner::vi_utils::on_test_file_end(vm.global(), next_load_shares_global);
            if next_load_shares_global {
                crate::test_runner::timers::fake_timers::on_test_file_end(vm.global());
            }
            Self::undo_module_mocks(vm, global, file_path, next_load_shares_global);
            // Must run after the cleanup above, so rejections from JS it runs are reported in this file.
            let _ = vm.global().handle_rejected_promises();

            if Output::is_github_action()
                && (reporter.worker_ipc_file_idx.is_none()
                    || reporter.worker_stands_for_one_process)
            {
                pretty_errorln!("<r>\n::endgroup::\n");
                Output::flush();
            }

            if !vm.test_isolation_enabled {
                // Ensure these never linger across files. Under --isolate this
                // is done by swapGlobalForTestIsolation() (kill+clear) and we
                // need tracking to remain enabled and populated until then.
                vm.auto_killer.clear();
                vm.auto_killer.disable();
            }

            repeat_index = if failed_to_load {
                repeat_count
            } else {
                repeat_index + 1
            };
            // Tear down before `EnteredFile` drops, so an error it throws is reported in this file.
            if repeat_index == repeat_count {
                environment.teardown(vm);
            }
        }
        if let Some(junit) = reporter.reporters.junit.as_mut() {
            let _ = junit.end_file(Some(junit_file_name(file_path)), None);
        }
        Ok(())
    }
}

struct PrintLogAfterFile(Option<core::ptr::NonNull<bun_ast::Log>>);

impl Drop for PrintLogAfterFile {
    fn drop(&mut self) {
        bun_ast::Expr::data_store_reset();
        bun_ast::Stmt::data_store_reset();

        if let Some(log) = self.0 {
            // SAFETY: the VM owns the Log and outlives `TestCommand::run`.
            let log = unsafe { &mut *log.as_ptr() };
            if log.errors > 0 {
                let _ = log.print(std::ptr::from_mut::<bun_core::io::Writer>(
                    Output::error_writer(),
                ));
                log.msgs.clear();
                log.errors = 0;
            }
        }

        Output::flush();
    }
}

struct RestoreOnlyAfterFile<'a> {
    reporter: &'a mut CommandLineReporter,
    only: bool,
}

impl Drop for RestoreOnlyAfterFile<'_> {
    fn drop(&mut self) {
        self.reporter.jest.only = self.only;
    }
}

struct EnteredFile<'a> {
    bun_test_root: *mut bun_test::BunTestRoot,
    global: &'a jsc::JSGlobalObject,
    next_load_shares_global: bool,
}

impl Drop for EnteredFile<'_> {
    fn drop(&mut self) {
        // SAFETY: `bun_test_root` belongs to `Jest::runner()`, which lives as long as the process.
        unsafe { (*self.bun_test_root).exit_file() };
        // A mock.module() patch still pending must not hold up the next file.
        bun_jsc::cpp::JSMock__forgetPendingModulePatches(self.global);
        bun_jsc::cpp::JSMock__undoModuleMocksOfTestFile(self.global, self.next_load_shares_global);
    }
}

pub(crate) fn handle_top_level_test_error_before_javascript_start(err: &crate::Error) -> ! {
    if cfg!(debug_assertions) {
        if !matches!(err, crate::Error::ModuleNotFound) {
            bun_core::debug_warn!("Unhandled error: {}", err.name());
        }
    }
    Global::exit(1);
}
