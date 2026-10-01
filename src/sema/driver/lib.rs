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
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

/// How much of the stack of a thread of the pool the checker lets itself use. What takes more is answered "unknown". The deepest any file of
/// a project of 45,000 goes is a quarter of a megabyte.
pub const STACK: usize = bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize * 3 / 4;

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
    /// The process ends once the errors have been shown.
    pub ends_the_process: bool,
    /// Nothing is forgotten once it is checked: for whoever goes on to ask about the program. It takes several times the memory.
    pub keeps_everything: bool,
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
}

#[derive(Default)]
pub struct Report {
    /// Sorted as TypeScript sorts them: what has no file first, then by path and position.
    pub diagnostics: Vec<Diagnostic>,
    /// Files whose check was given up on.
    pub gave_up: Vec<String>,
    /// The configuration file that was used. Empty if there is none.
    pub config_path: String,
    pub files_loaded: usize,
    pub files_checked: usize,
    pub load_time: Duration,
    pub check_time: Duration,
}

impl Report {
    pub fn error_count(&self) -> usize {
        self.diagnostics
            .iter()
            .filter(|d| d.category == Category::Error)
            .count()
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
    }
}

fn is_declaration_path(path: &str) -> bool {
    path.ends_with(".d.ts") || path.ends_with(".d.mts") || path.ends_with(".d.cts")
}

/// Where each line of `text` starts. `ComputeECMALineStarts`
fn line_starts(text: &[u8]) -> Vec<u32> {
    let mut starts = vec![0u32];
    let mut i = 0;
    while i < text.len() {
        match text[i] {
            b'\r' => {
                if text.get(i + 1) == Some(&b'\n') {
                    i += 1;
                }
                starts.push(i as u32 + 1);
            }
            b'\n' => starts.push(i as u32 + 1),
            // U+2028 and U+2029
            0xE2 if text.get(i + 1) == Some(&0x80)
                && matches!(text.get(i + 2), Some(0xA8 | 0xA9)) =>
            {
                i += 2;
                starts.push(i as u32 + 1);
            }
            _ => {}
        }
        i += 1;
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
        Some(path) => config::load(&disk, path),
        None => config::without_config(&disk, &cwd, default_compiler_options(), Vec::new()),
    };
    report.config_path = project.config_path.clone();
    if !request.paths.is_empty() {
        let mut roots = roots_of_paths(
            &disk,
            &cwd,
            request.paths,
            project.options.allow_js,
            &mut report.diagnostics,
        );
        // What the declaration files of the project declare is there for every file of it.
        roots.extend(
            project
                .files
                .iter()
                .filter(|f| is_declaration_path(f))
                .cloned(),
        );
        let mut seen = std::collections::HashSet::new();
        roots.retain(|root| seen.insert(root.clone()));
        project.files = roots;
        project.options.files = project.files.clone();
        // That the project itself names no files is beside the point.
        project
            .errors
            .retain(|e| e.code != 18003 && e.code != 18002);
    }
    report.diagnostics.extend(
        project
            .errors
            .iter()
            .map(|ConfigError { code, args }| global(*code, args)),
    );
    let lib_dir = match request.lib_dir {
        Some(dir) => Some(host::from_native(dir)),
        None => host::find_lib_dir(
            &disk,
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
    let files = Files::load(&disk, project.options, &project.files);
    let program = Program::new(files);
    report.files_loaded = program.files.modules.len();
    report.load_time = started.elapsed();
    if let Some(loaded) = request.loaded {
        loaded(&program);
    }
    report.diagnostics.extend(
        program
            .files
            .configuration_errors()
            .into_iter()
            .map(|code| global(code, &[])),
    );

    let checking = Instant::now();
    let mut to_check: Vec<FileId> = (0..program.files.modules.len())
        .filter(|&i| {
            let module = &program.files.modules[i];
            match module.hir.kind {
                FileKind::Json => false,
                _ if module.is_lib => !skip_lib_check && !skip_default_lib_check,
                FileKind::Declaration => !skip_lib_check,
                FileKind::Ts | FileKind::Tsx => true,
            }
        })
        .map(|i| FileId(i as u32))
        .collect();
    // The biggest first, so that none of them is what everybody waits for at the end.
    to_check.sort_by_key(|&f| std::cmp::Reverse(program.files.modules[f.idx()].hir.source_len));
    report.files_checked = to_check.len();
    let found: Mutex<Vec<Diagnostic>> = Mutex::new(Vec::new());
    let gave_up: Mutex<Vec<String>> = Mutex::new(Vec::new());
    for_each_parallel(threads, to_check.len(), &|i| {
        let file = to_check[i];
        // Dropped last, after all that was found out about the file.
        let _at_hand = program.files.bring_in(&disk, file);
        let module = &program.files.modules[file.idx()];
        let mut checker = program.checker();
        checker.set_stack_limit(STACK);
        checker.set_time_limit(request.file_time_limit);
        let errors = checker.check_file_explained(file);
        if checker.timed_out() {
            gave_up.lock().unwrap().push(module.path.clone());
            return;
        }
        if errors.is_empty() {
            return;
        }
        let text = &module.hir.text;
        let starts = line_starts(text);
        let shown: Vec<Diagnostic> = errors
            .into_iter()
            .map(|e| {
                let (line, character) = line_and_character(text, &starts, e.start);
                let (end_line, end_character) =
                    line_and_character(text, &starts, e.end.max(e.start));
                let source_line = line.saturating_sub(LINES_BEFORE);
                let last_line = (end_line + LINES_AFTER).min(starts.len() as u32 - 1);
                Diagnostic {
                    path: module.path.clone(),
                    start: e.start,
                    end: e.end,
                    line: line + 1,
                    column: character + 1,
                    end_line: end_line + 1,
                    end_column: end_character + 1,
                    code: e.code,
                    category: e.category,
                    text: e.text,
                    source: (source_line..=last_line)
                        .map(|l| line_text(text, &starts, l))
                        .collect(),
                    source_line: source_line + 1,
                }
            })
            .collect();
        found.lock().unwrap().extend(shown);
    });
    report.diagnostics.extend(found.into_inner().unwrap());
    report.gave_up = gave_up.into_inner().unwrap();
    report.gave_up.sort();
    // `CompareDiagnostics`
    report.diagnostics.sort_by(|a, b| {
        (&a.path, a.start, a.end, a.code, &a.text).cmp(&(&b.path, b.start, b.end, b.code, &b.text))
    });
    report.check_time = checking.elapsed();
    if let Some(checked) = request.checked {
        checked(&program);
    }
    // Giving back millions of small pieces of memory one by one takes a while, and the system takes it all back at once.
    if request.ends_the_process {
        std::mem::forget(program);
        std::mem::forget(disk);
    }
    report
}
