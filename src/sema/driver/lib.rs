//! Type checks a project: finds its configuration and its files, checks them on every core, and says what is wrong.
//!
//! `bun check`, `bun build --check` and `bun run --check` are this with different roots and a different way of showing the result.

pub mod format;
pub mod host;

pub use bun_sema::messages::Category;

use bun_sema::check::Program;
use bun_sema::config::{self, ConfigError};
use bun_sema::hir::FileKind;
use bun_sema::json::Json;
use bun_sema::messages;
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{Host, join, parent_dir};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

/// Runs `work(i)` for every `i` below `count` on the threads everything else in Bun runs on, no more than `threads` of them at a time. They take
/// the numbers in order, each the next one when it is done with the last.
pub fn for_each_parallel(threads: usize, count: usize, work: &(dyn Fn(usize) + Sync)) {
    for_each_parallel_in_runs(threads, count, 1, work);
}

/// The same, each thread taking `run` numbers in a row at a time.
pub fn for_each_parallel_in_runs(
    threads: usize,
    count: usize,
    run: usize,
    work: &(dyn Fn(usize) + Sync),
) {
    if count == 0 {
        return;
    }
    let next = AtomicUsize::new(0);
    let mut runners = vec![(); threads.clamp(1, count.div_ceil(run))];
    bun_threading::WorkPool::get().each(
        (),
        |(), (), _| loop {
            let from = next.fetch_add(run, Ordering::Relaxed);
            if from >= count {
                break;
            }
            for i in from..(from + run).min(count) {
                work(i);
            }
        },
        &mut runners,
    );
}

/// How far a check has got. Read from another thread.
#[derive(Default)]
pub struct Progress {
    /// How many files there are to check. 0: the program is still being loaded.
    pub to_check: AtomicUsize,
    pub checked: AtomicUsize,
    /// The same in bytes of source, which says more about how long it will take: the biggest files go first.
    pub bytes_to_check: AtomicUsize,
    pub bytes_checked: AtomicUsize,
    /// How many errors have been found.
    pub errors: AtomicUsize,
}

#[derive(Clone, Copy)]
pub struct Request<'a> {
    /// The working directory, as the operating system names it.
    pub cwd: &'a str,
    /// `--project`: a configuration file, or a directory with a `tsconfig.json` in it.
    pub project: Option<&'a str>,
    /// Files and directories to check instead of all the project names. The options are still the project's.
    pub paths: &'a [String],
    /// `0`: as many as there are cores.
    pub threads: usize,
    /// Where TypeScript's `lib.*.d.ts` are, if that is not to be found out.
    pub lib_dir: Option<&'a str>,
    /// The `node_modules` of what is installed globally, where they are looked for last.
    pub global_node_modules: Option<&'a str>,
    /// How long a single file may take. One that takes longer has run into a bug, and nothing is said about it but that.
    pub file_time_limit: Duration,
    /// Kept up to date on the way, for whoever shows how far it has got.
    pub progress: Option<&'a Progress>,
    /// Of all that is loaded, only the files with this in their path are checked. For looking into one file of a big project.
    pub only: Option<&'a str>,
    /// The process ends once the errors have been shown.
    pub ends_the_process: bool,
    /// Nothing is forgotten once it is checked: for whoever goes on to ask about the program. It takes several times the memory.
    pub keeps_everything: bool,
    /// As `tsc` does: if something does not parse, that is all that is said. If the options do not go together, that is. Only then come the
    /// errors about types.
    pub stops_where_tsc_does: bool,
    /// Word for word, where Bun would put it otherwise (`bun add -d` for `npm i --save-dev`). For comparing with TypeScript.
    pub says_it_as_typescript_does: bool,
    /// Called with everything that was loaded, before any of it is checked.
    pub loaded: Option<&'a (dyn Fn(&Program) + Sync)>,
    /// Called with it again when all of it is checked.
    pub checked: Option<&'a (dyn Fn(&Program) + Sync)>,
}

/// Something that is wrong, ready to be shown.
#[derive(Clone, Debug)]
pub struct Diagnostic {
    /// The file, as the checker names it. Empty for what is wrong with the configuration.
    pub path: String,
    /// Offsets in bytes.
    pub start: u32,
    pub end: u32,
    /// From 1. Columns count UTF-16 code units, as TypeScript's do.
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub code: u32,
    pub category: Category,
    /// The message. Lines after the first are reasons, indented by two spaces a level.
    pub text: String,
    /// Lines of the file from `source_line` on, without their line terminators: a few before the error, those it is on, a few after.
    pub source: Vec<String>,
    pub source_line: u32,
    /// What else has to do with it: `'x' is declared here.` None of these has any of its own.
    pub related: Vec<Diagnostic>,
}

#[derive(Default)]
pub struct Report {
    /// Sorted as TypeScript sorts them: what has no file first, then by path and position.
    pub diagnostics: Vec<Diagnostic>,
    /// Files whose check was given up on.
    pub gave_up: Vec<String>,
    /// Files in which something went unanswered for want of stack: errors may be missing.
    pub incomplete: Vec<String>,
    /// The configuration file that was used. Empty if there is none.
    pub config_path: String,
    pub files_loaded: usize,
    pub files_checked: usize,
    /// How many projects were checked, if the configuration has `references`. Otherwise 0.
    pub projects_checked: usize,
    pub load_time: Duration,
    pub check_time: Duration,
    /// The most stack any file took, in bytes.
    pub deepest_stack: usize,
}

impl Report {
    pub fn error_count(&self) -> usize {
        self.diagnostics
            .iter()
            .filter(|d| d.category == Category::Error)
            .count()
    }

    /// Adds the result of checking another project. The diagnostics are left unsorted.
    fn merge(&mut self, other: Report) {
        self.diagnostics.extend(other.diagnostics);
        self.gave_up.extend(other.gave_up);
        self.incomplete.extend(other.incomplete);
        self.files_loaded += other.files_loaded;
        self.files_checked += other.files_checked;
        self.check_time += other.check_time;
        self.deepest_stack = self.deepest_stack.max(other.deepest_stack);
    }
}

/// How many lines before and after an error are kept with it. How many of them are shown is up to the layout.
const LINES_BEFORE: u32 = 3;
const LINES_AFTER: u32 = 2;

/// What is checked by where there is no configuration file: what `bun init` writes, less the rules that are a matter of taste.
fn default_compiler_options() -> Json {
    let text = br#"{
        "lib": ["ESNext"], "target": "ESNext", "module": "Preserve", "moduleDetection": "force", "jsx": "react-jsx",
        "allowJs": true, "moduleResolution": "bundler", "allowImportingTsExtensions": true, "verbatimModuleSyntax": true,
        "noEmit": true, "strict": true, "skipLibCheck": true
    }"#;
    Json::parse(text).unwrap_or(Json::Null)
}

fn global(code: u32, args: &[String]) -> Diagnostic {
    let (category, template) =
        messages::message(code).unwrap_or((Category::Error, "Unknown error."));
    Diagnostic {
        path: String::new(),
        start: 0,
        end: 0,
        line: 0,
        column: 0,
        end_line: 0,
        end_column: 0,
        code,
        category,
        text: messages::format(template, args),
        source: Vec::new(),
        source_line: 0,
        related: Vec::new(),
    }
}

/// TypeScript's messages say how to install types with npm.
fn in_terms_of_bun(text: String) -> String {
    const NPM: &str = "npm i --save-dev ";
    if text.contains(NPM) {
        text.replace(NPM, "bun add -d ")
    } else {
        text
    }
}

/// `said`, of the bytes `start..end` of the file at `path`, which reads `text` and whose lines start at `starts`.
fn located(
    path: &str,
    text: &[u8],
    starts: &[u32],
    start: u32,
    end: u32,
    said: Diagnostic,
) -> Diagnostic {
    let (line, character) = line_and_character(text, starts, start);
    let (end_line, end_character) = line_and_character(text, starts, end.max(start));
    let source_line = line.saturating_sub(LINES_BEFORE);
    let last_line = (end_line + LINES_AFTER).min(starts.len() as u32 - 1);
    Diagnostic {
        path: path.to_owned(),
        start,
        end,
        line: line + 1,
        column: character + 1,
        end_line: end_line + 1,
        end_column: end_character + 1,
        source: (source_line..=last_line)
            .map(|l| line_text(text, starts, l))
            .collect(),
        source_line: source_line + 1,
        ..said
    }
}

/// Where each line of `text` starts. `ComputeECMALineStarts`
fn line_starts(text: &[u8]) -> Vec<u32> {
    let mut starts = vec![0u32];
    let mut i = 0;
    // 0xE2 starts U+2028 and U+2029, which end a line too.
    while let Some(found) = bun_core::strings::index_of_any(&text[i..], b"\n\r\xE2") {
        i += found;
        match text[i] {
            b'\r' if text.get(i + 1) == Some(&b'\n') => i += 1,
            0xE2 => {
                if text.get(i + 1) != Some(&0x80) || !matches!(text.get(i + 2), Some(0xA8 | 0xA9)) {
                    i += 1;
                    continue;
                }
                i += 2;
            }
            _ => {}
        }
        i += 1;
        starts.push(i as u32);
    }
    starts
}

/// The line `offset` is on, from 0, and how many UTF-16 code units come before it there.
fn line_and_character(text: &[u8], starts: &[u32], offset: u32) -> (u32, u32) {
    let offset = offset.min(text.len() as u32);
    let line = starts.partition_point(|&s| s <= offset) - 1;
    let before = &text[starts[line] as usize..offset as usize];
    let units = String::from_utf8_lossy(before).encode_utf16().count();
    (line as u32, units as u32)
}

fn line_text(text: &[u8], starts: &[u32], line: u32) -> String {
    let from = starts[line as usize] as usize;
    let to = starts
        .get(line as usize + 1)
        .map_or(text.len(), |&s| s as usize);
    String::from_utf8_lossy(&text[from..to])
        .trim_end_matches(['\n', '\r', '\u{2028}', '\u{2029}'])
        .to_owned()
}

/// The roots `paths` stand for: a file is itself, a directory is what a project with nothing but that directory would include.
fn roots_of_paths(
    disk: &host::Disk,
    cwd: &str,
    paths: &[String],
    allow_js: bool,
    errors: &mut Vec<Diagnostic>,
) -> Vec<String> {
    let mut roots = Vec::new();
    for path in paths {
        let path = join(cwd, &path.replace('\\', "/"));
        if disk.is_dir(&path) {
            let compiler = Json::Object(vec![("allowJs".to_owned(), Json::Bool(allow_js))]);
            roots.extend(config::without_config(disk, &path, compiler, Vec::new()).files);
        } else if disk.is_file(&path) {
            roots.push(path);
        } else {
            errors.push(global(6053, &[path]));
        }
    }
    roots
}

/// From how many bytes on a file is checked before the others.
const BIG_FILE: u32 = 64 << 10;

/// What is long for a file that is not big.
const SLOW: Duration = Duration::from_millis(40);

pub fn check(request: &Request) -> Report {
    let started = Instant::now();
    let threads = match request.threads {
        0 => std::thread::available_parallelism().map_or(4, usize::from),
        n => n,
    };
    let disk = host::Disk::new(threads);
    let cwd = host::from_native(request.cwd);
    let mut report = Report::default();

    let config_path = match request.project {
        Some(project) => {
            let path = join(&cwd, &project.replace('\\', "/"));
            if disk.is_dir(&path) {
                let inside = join(&path, "tsconfig.json");
                if !disk.is_file(&inside) {
                    report.diagnostics.push(global(5057, &[path]));
                    return report;
                }
                Some(inside)
            } else if disk.is_file(&path) {
                Some(path)
            } else {
                report.diagnostics.push(global(5058, &[path]));
                return report;
            }
        }
        // The project the first thing named belongs to, or else the one around here.
        None => request
            .paths
            .first()
            .map(|first| join(&cwd, &first.replace('\\', "/")))
            .and_then(|first| {
                let dir = if disk.is_dir(&first) {
                    first
                } else {
                    parent_dir(&first).to_owned()
                };
                config::find_config(&disk, &dir)
            })
            .or_else(|| config::find_config(&disk, &cwd)),
    };
    let mut project = match &config_path {
        // Nothing is written, whatever the project says: this is `tsc --noEmit`. What is only wrong with where output would go is not
        // looked into.
        Some(path) => {
            config::load_overriding(&disk, path, vec![("noEmit".to_owned(), Json::Bool(true))])
        }
        None => config::without_config(&disk, &cwd, default_compiler_options(), Vec::new()),
    };
    report.config_path = project.config_path.clone();
    let mut named = None;
    if !request.paths.is_empty() {
        let mut roots = roots_of_paths(
            &disk,
            &cwd,
            request.paths,
            project.options.allow_js,
            &mut report.diagnostics,
        );
        // The program is the whole project all the same. What one file adds to the global scope, or to a module, is there for every
        // other: a file means the same, and has the same errors, whether it is named or not.
        let mut seen: std::collections::HashSet<&str> =
            project.files.iter().map(String::as_str).collect();
        let more: Vec<String> = roots
            .iter()
            .filter(|root| seen.insert(root.as_str()))
            .cloned()
            .collect();
        project.files.extend(more);
        project.options.files = project.files.clone();
        // That the project itself names no files is beside the point.
        project
            .errors
            .retain(|e| e.code != 18003 && e.code != 18002);
        roots.sort_unstable();
        named = Some(roots);
    }
    let report = if named.is_none() && !project.references.is_empty() {
        check_with_references(&disk, project, request, report, started)
    } else {
        check_what_is_named(&disk, project, request, report, started, named, None)
    };
    if request.ends_the_process {
        std::mem::forget(disk);
    }
    report
}

struct ReferencedProject {
    project: config::Project,
    /// Indices into the list of projects.
    references: Vec<usize>,
}

/// Appends `project` after the projects it references, transitively, so that dependencies come first. Each config file is loaded
/// once. Returns the index of `project`, or `None` if it is already being visited (TS6202).
fn collect_referenced_projects(
    host: &dyn Host,
    project: config::Project,
    projects: &mut Vec<ReferencedProject>,
    index_of: &mut std::collections::HashMap<String, Option<usize>>,
    diagnostics: &mut Vec<Diagnostic>,
) -> Option<usize> {
    index_of.insert(project.config_path.clone(), None);
    let dir = parent_dir(&project.config_path).to_owned();
    let mut references = Vec::new();
    for reference in &project.references {
        // `resolveProjectReferencePath`
        let path = join(&dir, reference);
        let path = if path.ends_with(".json") {
            path
        } else {
            join(&path, "tsconfig.json")
        };
        match index_of.get(&path) {
            Some(Some(index)) => references.push(*index),
            Some(None) => {
                diagnostics.push(global(6202, &[format!("{}\n{path}", project.config_path)]))
            }
            None if !host.is_file(&path) => diagnostics.push(global(6053, &[path])),
            None => {
                let referenced = config::load_overriding(
                    host,
                    &path,
                    vec![("noEmit".to_owned(), Json::Bool(true))],
                );
                references.extend(collect_referenced_projects(
                    host,
                    referenced,
                    projects,
                    index_of,
                    diagnostics,
                ));
            }
        }
    }
    let index = projects.len();
    index_of.insert(project.config_path.clone(), Some(index));
    projects.push(ReferencedProject {
        project,
        references,
    });
    Some(index)
}

/// What `tsc -b` checks: `root` and every project it references, each with its own options. Nothing has to be built first: an
/// import from a referenced project resolves to its source, where `tsc` would read the `.d.ts` it emitted.
fn check_with_references(
    host: &dyn Host,
    root: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
) -> Report {
    let mut projects = Vec::new();
    collect_referenced_projects(
        host,
        root,
        &mut projects,
        &mut std::collections::HashMap::new(),
        &mut report.diagnostics,
    );
    // A file that belongs to a referenced project is checked there, with that project's options.
    let roots: Vec<Vec<String>> = projects.iter().map(|p| p.project.files.clone()).collect();
    let references: Vec<Vec<usize>> = projects.iter().map(|p| p.references.clone()).collect();
    let last = projects.len() - 1;
    for (index, referenced) in projects.into_iter().enumerate() {
        let mut project = referenced.project;
        if project.files.is_empty() {
            // A solution file: `"files": []` or `"include": []` with references only.
            project
                .errors
                .retain(|e| e.code != 18003 && e.code != 18002);
            if project.errors.is_empty() {
                continue;
            }
        }
        let mut is_referenced = vec![false; roots.len()];
        let mut pending = references[index].clone();
        while let Some(i) = pending.pop() {
            if !std::mem::replace(&mut is_referenced[i], true) {
                pending.extend(&references[i]);
            }
        }
        let own: std::collections::HashSet<&str> =
            roots[index].iter().map(String::as_str).collect();
        let owned_elsewhere: std::collections::HashSet<&str> = (0..roots.len())
            .filter(|&i| is_referenced[i])
            .flat_map(|i| roots[i].iter().map(String::as_str))
            .filter(|path| !own.contains(path))
            .collect();
        let request = Request {
            ends_the_process: request.ends_the_process && index == last,
            ..*request
        };
        report.merge(check_what_is_named(
            host,
            project,
            &request,
            Report::default(),
            Instant::now(),
            None,
            Some(&owned_elsewhere),
        ));
        report.projects_checked += 1;
    }
    report.load_time = started.elapsed().saturating_sub(report.check_time);
    sort_and_deduplicate(&mut report.diagnostics);
    report
}

/// `SortAndDeduplicateDiagnostics`, with `CompareDiagnostics`.
fn sort_and_deduplicate(diagnostics: &mut Vec<Diagnostic>) {
    diagnostics.sort_by(|a, b| {
        (&a.path, a.start, a.end, a.code, &a.text).cmp(&(&b.path, b.start, b.end, b.code, &b.text))
    });
    diagnostics.dedup_by(|a, b| {
        (&a.path, a.start, a.end, a.code, &a.text) == (&b.path, b.start, b.end, b.code, &b.text)
    });
}

/// Checks `project`, which is read through `host`. `report` has what has been found wrong on the way to it, since `started`.
pub fn check_project(
    host: &dyn Host,
    project: config::Project,
    request: &Request,
    report: Report,
    started: Instant,
) -> Report {
    check_what_is_named(host, project, request, report, started, None, None)
}

/// `check_project`. `named`: of all that is loaded, only these files, sorted, and what they refer to is checked.
/// `owned_elsewhere`: files of referenced projects, which are loaded but not checked.
fn check_what_is_named(
    host: &dyn Host,
    mut project: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
    named: Option<Vec<String>>,
    owned_elsewhere: Option<&std::collections::HashSet<&str>>,
) -> Report {
    let threads = match request.threads {
        0 => std::thread::available_parallelism().map_or(4, usize::from),
        n => n,
    };
    let of_configuration = |error: &ConfigError| {
        let mut said = global(error.code, &error.args);
        for (level, code, args) in &error.chain {
            said.text.push('\n');
            for _ in 0..*level {
                said.text.push_str("  ");
            }
            said.text.push_str(&global(*code, args).text);
        }
        match &error.at {
            Some((path, from, to)) => match host.read(path) {
                Some(text) => located(path, &text, &line_starts(&text), *from, *to, said),
                None => said,
            },
            None => said,
        }
    };
    // `GetDiagnosticsOfAnyProgram`: what is wrong with the way the configuration file is written is said whatever else there is to say.
    report.diagnostics.extend(
        project
            .errors
            .iter()
            .filter(|error| !error.is_about_options)
            .map(of_configuration),
    );
    let said_at_any_rate = report.diagnostics.len();
    let mut about_options: Vec<Diagnostic> = project
        .errors
        .iter()
        .filter(|error| error.is_about_options)
        .map(of_configuration)
        .collect();
    let config_path = project.config_path.clone();
    let lib_dir = match request.lib_dir {
        Some(dir) => Some(host::from_native(dir)),
        None => host::find_lib_dir(
            host,
            &project.options.base_dir,
            request
                .global_node_modules
                .map(host::from_native)
                .as_deref(),
        ),
    };
    match lib_dir {
        Some(dir) => project.options.lib_dir = dir,
        None if project.options.no_lib => {}
        None => {
            report.diagnostics.push(Diagnostic {
                text: "Cannot find TypeScript's standard library (lib.es5.d.ts and the rest), which declares Array, Promise and \
                       everything else that is built in. It comes with the typescript package: bun add -d typescript"
                    .to_owned(),
                code: 0,
                ..global(6053, &[])
            });
            return report;
        }
    }
    let (skip_lib_check, skip_default_lib_check) = (
        project.options.skip_lib_check,
        project.options.skip_default_lib_check,
    );

    project.options.drops_what_nothing_refers_to = !request.keeps_everything;
    let files = Files::load(host, project.options, &project.files);
    let program = Program::new(files);
    report.files_loaded = program.files.modules.len();
    report.load_time = started.elapsed();
    if let Some(loaded) = request.loaded {
        loaded(&program);
    }
    about_options.extend(
        program
            .files
            .program_problems()
            .iter()
            .map(|problem| of_configuration(&ConfigError::of_problem(host, &config_path, problem))),
    );

    let checking = Instant::now();
    let mut to_check: Vec<FileId> = (0..program.files.modules.len())
        .filter(|&i| {
            let module = &program.files.modules[i];
            match module.hir.kind {
                // Only what the parser objects to is said of JSON, and only then is its text kept.
                FileKind::Json => !module.hir.text.is_empty(),
                _ if module.is_lib => !skip_lib_check && !skip_default_lib_check,
                FileKind::Declaration => !skip_lib_check,
                FileKind::Ts | FileKind::Tsx => true,
            }
        })
        .map(|i| FileId(i as u32))
        .collect();
    let is_reached = named.as_ref().map(|named| {
        let modules = &program.files.modules;
        let mut is_reached = vec![false; modules.len()];
        let mut to_follow: Vec<usize> = (0..modules.len())
            .filter(|&i| named.binary_search(&modules[i].path).is_ok())
            .collect();
        for &i in &to_follow {
            is_reached[i] = true;
        }
        while let Some(i) = to_follow.pop() {
            for edge in &modules[i].edges {
                if !std::mem::replace(&mut is_reached[edge.idx()], true) {
                    to_follow.push(edge.idx());
                }
            }
        }
        is_reached
    });
    if let Some(is_reached) = &is_reached {
        to_check.retain(|file| is_reached[file.idx()]);
    }
    if let Some(owned_elsewhere) = owned_elsewhere {
        to_check
            .retain(|&f| !owned_elsewhere.contains(program.files.modules[f.idx()].path.as_str()));
    }
    if let Some(only) = request.only {
        to_check.retain(|&f| program.files.modules[f.idx()].path.contains(only));
    }
    // The biggest first, so that none of them is what everybody waits for at the end. Among the rest, how long a file takes has little to do
    // with how long it is: a few lines can ask a lot of the types they use. In order of size all of those would come last. In no
    // particular order, which is the same each time, one is as likely to come early.
    let size = |f: FileId| program.files.modules[f.idx()].hir.source_len;
    to_check.sort_by_key(|&f| std::cmp::Reverse(size(f)));
    let big = to_check.partition_point(|&f| size(f) >= BIG_FILE);
    to_check[big..].sort_by_cached_key(|&f| {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        program.files.modules[f.idx()].path.hash(&mut hasher);
        hasher.finish()
    });
    report.files_checked = to_check.len();
    if let Some(progress) = request.progress {
        let bytes = to_check
            .iter()
            .map(|f| program.files.modules[f.idx()].hir.source_len as usize)
            .sum();
        progress.bytes_to_check.store(bytes, Ordering::Relaxed);
        progress.to_check.store(to_check.len(), Ordering::Relaxed);
    }
    let found: Mutex<Vec<Diagnostic>> = Mutex::new(Vec::new());
    let gave_up: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let incomplete: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let deepest_stack = AtomicUsize::new(0);
    // Files that ask a lot of the same types tend to be next to each other. When a small file turns out to take long, what else is in its
    // directory goes first, so that none of it is left for the end.
    let mut neighbors: std::collections::HashMap<&str, Vec<usize>> = Default::default();
    for (i, &file) in to_check.iter().enumerate().skip(big) {
        let path = &program.files.modules[file.idx()].path[..];
        neighbors
            .entry(bun_sema::resolve::parent_dir(path))
            .or_default()
            .push(i);
    }
    let is_taken: Vec<AtomicBool> = to_check.iter().map(|_| AtomicBool::new(false)).collect();
    let goes_first: Mutex<Vec<usize>> = Mutex::new(Vec::new());
    let check_file = |file: FileId, only_syntax: bool| {
        // Dropped last, after all that was found out about the file.
        let _at_hand = program.files.bring_in(host, file);
        let module = &program.files.modules[file.idx()];
        let mut checker = program.checker();
        checker.set_only_syntax(only_syntax);
        // What the thread really has left, whatever thread it is and however it was built.
        checker.set_stack_limit(bun_core::StackCheck::init().remaining());
        checker.set_time_limit(request.file_time_limit);
        let errors = checker.check_file_explained(file);
        deepest_stack.fetch_max(checker.deepest_stack(), Ordering::Relaxed);
        if checker.timed_out() {
            gave_up.lock().unwrap().push(module.path.clone());
            return;
        }
        // What was found stands. What was not may be missing, and that is said.
        if checker.ran_out_of_stack() {
            incomplete.lock().unwrap().push(module.path.clone());
        }
        if errors.is_empty() {
            return;
        }
        let text = &module.hir.text;
        let starts = line_starts(text);
        let shown: Vec<Diagnostic> = errors
            .into_iter()
            .map(|e| {
                let related = e
                    .related
                    .into_iter()
                    .map(|related| {
                        let said = Diagnostic {
                            code: related.code,
                            category: related.category,
                            text: related.text,
                            ..global(0, &[])
                        };
                        let Some((of, start, end)) = related.at else {
                            return said;
                        };
                        if of == file {
                            return located(&module.path, text, &starts, start, end, said);
                        }
                        let other = &program.files.modules[of.idx()];
                        // The text of the default library is not kept.
                        let read;
                        let text = if other.hir.text.is_empty() {
                            read = host.read(&other.path).unwrap_or_default();
                            &read[..]
                        } else {
                            &other.hir.text[..]
                        };
                        located(&other.path, text, &line_starts(text), start, end, said)
                    })
                    .collect();
                let said = Diagnostic {
                    related,
                    code: e.code,
                    category: e.category,
                    text: if request.says_it_as_typescript_does {
                        e.text
                    } else {
                        in_terms_of_bun(e.text)
                    },
                    ..global(0, &[])
                };
                located(&module.path, text, &starts, e.start, e.end, said)
            })
            .collect();
        if let Some(progress) = request.progress {
            progress.errors.fetch_add(shown.len(), Ordering::Relaxed);
        }
        found.lock().unwrap().extend(shown);
    };
    let take = |i: usize| {
        if is_taken[i].swap(true, Ordering::Relaxed) {
            return;
        }
        let began = Instant::now();
        check_file(to_check[i], false);
        if let Some(progress) = request.progress {
            progress.checked.fetch_add(1, Ordering::Relaxed);
            progress
                .bytes_checked
                .fetch_add(size(to_check[i]) as usize, Ordering::Relaxed);
        }
        if i >= big && began.elapsed() >= SLOW {
            let path = &program.files.modules[to_check[i].idx()].path[..];
            let next_to_it = &neighbors[bun_sema::resolve::parent_dir(path)];
            goes_first.lock().unwrap().extend(
                next_to_it
                    .iter()
                    .filter(|&&j| !is_taken[j].load(Ordering::Relaxed)),
            );
        }
    };
    let take_what_goes_first = || {
        loop {
            let next = goes_first.lock().unwrap().pop();
            match next {
                Some(i) => take(i),
                None => break,
            }
        }
    };
    let global_errors = || -> Vec<Diagnostic> {
        program
            .global_errors()
            .iter()
            .map(|(code, args)| global(*code, args))
            .collect()
    };
    // `GetDiagnosticsOfAnyProgram`: TypeScript's command line goes on to the next kind of error only if there is none of the last. What
    // does not parse, or is checked under options that make no sense, gives errors that are not worth reading.
    let stops = request.stops_where_tsc_does;
    'stages: {
        if stops {
            let suspects: Vec<FileId> = (0..program.files.modules.len())
                .filter(|&i| {
                    let hir = &program.files.modules[i].hir;
                    (hir.has_parse_diagnostics || !hir.early_errors.is_empty() || hir.is_js)
                        && is_reached.as_ref().is_none_or(|reached| reached[i])
                })
                .map(|i| FileId(i as u32))
                .collect();
            for_each_parallel(threads, suspects.len(), &|i| check_file(suspects[i], true));
            let mut found = found.lock().unwrap();
            if !found.is_empty() {
                report.diagnostics.append(&mut found);
                report.files_checked = 0;
                break 'stages;
            }
        }
        report.diagnostics.append(&mut about_options);
        if stops {
            report.diagnostics.extend(global_errors());
            if report.diagnostics.len() > said_at_any_rate {
                report.files_checked = 0;
                break 'stages;
            }
        }
        for_each_parallel(threads, to_check.len(), &|i| {
            take_what_goes_first();
            take(i);
            // Whoever finds out at the very end is the only one left to act on it.
            take_what_goes_first();
        });
        report.diagnostics.append(&mut found.lock().unwrap());
        report.diagnostics.extend(global_errors());
    }
    report.gave_up = gave_up.into_inner().unwrap();
    report.deepest_stack = deepest_stack.into_inner();
    report.gave_up.sort();
    report.incomplete = incomplete.into_inner().unwrap();
    report.incomplete.sort();
    report.incomplete.dedup();
    sort_and_deduplicate(&mut report.diagnostics);
    // What the program says of no file is at -1 (`NewCompilerDiagnostic`), what the checker says of none at 0 (`NewDiagnosticForNode`).
    let of_the_checker = program.global_errors();
    let in_no_file = report.diagnostics.partition_point(|d| d.path.is_empty());
    report.diagnostics[..in_no_file]
        .sort_by_key(|d| of_the_checker.iter().any(|(code, _)| *code == d.code));
    report.check_time = checking.elapsed();
    if let Some(checked) = request.checked {
        checked(&program);
    }
    // Giving back millions of small pieces of memory one by one takes a while, and the system takes it all back at once.
    if request.ends_the_process {
        std::mem::forget(program);
    }
    report
}
