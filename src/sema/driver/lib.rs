//! Type checks a project: finds its configuration and its files, checks them on every core, and says what is wrong.
//!
//! `bun check`, `bun build --check` and `bun run --check` are this with different roots and a different way of showing the result.

pub mod format;
pub mod host;

pub use bun_sema::messages::Category;

use bstr::ByteSlice;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::check::errors::Checked;
use bun_sema::check::explain::Explained;
use bun_sema::check::{Program, compute_ecma_line_starts};
use bun_sema::config::{self, ConfigError};
use bun_sema::hir::FileKind;
use bun_sema::json::Json;
use bun_sema::messages;
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{Host, Phase, join};
use bun_sema::util::{FxHashMap, FxHashSet};
use bun_sema::verify::verify_project_references;
use bun_threading::Guarded;
use std::sync::atomic::{AtomicUsize, Ordering};
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

/// A compiler option and its value, from [`compiler_option_from_flag`].
#[derive(Clone)]
pub struct CompilerOption(Vec<u8>, Json);

pub enum FlagError {
    /// No compiler option has this name.
    Unknown,
    /// The option takes a value and none was given, or it cannot be given on a command line.
    NeedsValue,
    /// The value is not one the option takes. The allowed values, if there is a fixed set.
    BadValue(&'static [&'static [u8]]),
}

/// Whether the compiler option `name`, in any case, is a boolean, so that its value may be left out.
pub fn is_boolean_compiler_option(name: &[u8]) -> bool {
    bun_sema::config_options::choices(name) == Some(&[b"true".as_slice(), b"false"][..])
}

/// `--name value` as `tsc` reads it. `name` is matched case-insensitively. A boolean without a value is `true`.
pub fn compiler_option_from_flag(
    name: &[u8],
    value: Option<&[u8]>,
) -> Result<CompilerOption, FlagError> {
    use bun_sema::config_options::{choices, from_text};
    let allowed = choices(name);
    let value = match value {
        Some(value) => value,
        None if is_boolean_compiler_option(name) => b"true",
        // `from_text` with any text tells an unknown option from one that needs a value.
        None if allowed.is_some() || from_text(name, b"0").is_some() => {
            return Err(FlagError::NeedsValue);
        }
        None => return Err(FlagError::Unknown),
    };
    if let Some(allowed) = allowed
        && !allowed.iter().any(|a| a.eq_ignore_ascii_case(value))
    {
        return Err(FlagError::BadValue(allowed));
    }
    match from_text(name, value) {
        Some((name, value)) => Ok(CompilerOption(name.to_vec(), value)),
        None if allowed.is_some() || from_text(name, b"0").is_some() => {
            Err(FlagError::BadValue(&[]))
        }
        None => Err(FlagError::Unknown),
    }
}

/// `noEmit`, since nothing is ever written, after what the command line says.
fn overriding_options(request: &Request, is_build: bool) -> Vec<(Vec<u8>, Json)> {
    request
        .compiler_options
        .iter()
        .map(|option| (option.0.clone(), option.1.clone()))
        .chain((!is_build).then(|| (b"noEmit".to_vec(), Json::Bool(true))))
        .collect()
}

#[derive(Clone, Copy)]
pub struct Request<'a> {
    /// The working directory, as the operating system names it.
    pub cwd: &'a [u8],
    /// `--project`: a configuration file, or a directory with a `tsconfig.json` in it.
    pub project: Option<&'a [u8]>,
    /// Files and directories to check instead of all the project names. The options are still the project's.
    pub paths: &'a [Vec<u8>],
    /// Compiler options given on the command line. They override the configuration file, also of referenced projects.
    pub compiler_options: &'a [CompilerOption],
    /// `0`: as many as there are cores.
    pub threads: usize,
    /// Where TypeScript's `lib.*.d.ts` are, if that is not to be found out.
    pub lib_dir: Option<&'a [u8]>,
    /// The `node_modules` of what is installed globally, where they are looked for last.
    pub global_node_modules: Option<&'a [u8]>,
    /// Kept up to date on the way, for whoever shows how far it has got.
    pub progress: Option<&'a Progress>,
    /// Of all that is loaded, only the files with this in their path are checked. For looking into one file of a big project.
    pub only: Option<&'a [u8]>,
    /// Files are started in the order of rank * `order` (mod 2^32). 1 = program order. Any other odd number is a fixed permutation.
    /// The output does not depend on it. For tests of that property.
    pub order: u32,
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
    /// Called for each file right after it is checked, on the thread that checked it, while the types that are local to the file
    /// are still alive. The way to read the type of every expression without `keeps_everything`.
    pub after_file: Option<&'a (dyn Fn(&mut bun_sema::check::Checker<'_>, FileId) + Sync)>,
}

/// Something that is wrong, ready to be shown.
#[derive(Clone, Debug)]
pub struct Diagnostic {
    /// The file, as the checker names it. Empty for what is wrong with the configuration.
    pub path: Vec<u8>,
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
    pub text: Vec<u8>,
    /// Lines of the file from `source_line` on, without their line terminators: a few before the error, those it is on, a few after.
    pub source: Vec<Vec<u8>>,
    pub source_line: u32,
    /// What else has to do with it: `'x' is declared here.` None of these has any of its own.
    pub related: Vec<Diagnostic>,
}

#[derive(Default)]
pub struct Report {
    /// Sorted as TypeScript sorts them: what has no file first, then by path and position.
    pub diagnostics: Vec<Diagnostic>,
    /// Files in which something went unanswered for want of stack: errors may be missing.
    pub incomplete: Vec<Vec<u8>>,
    /// Whether `@types/bun` is where a project that was checked would find it.
    pub has_bun_types_installed: bool,
    /// The configuration file that was used. Empty if there is none.
    pub config_path: Vec<u8>,
    /// `listFiles`, `listFilesOnly`: the files of the program, in its order.
    pub listed_files: Vec<Vec<u8>>,
    pub files_loaded: usize,
    pub files_checked: usize,
    /// How many projects were checked, if the configuration has `references`. Otherwise 0.
    pub projects_checked: usize,
    pub load_time: Duration,
    pub check_time: Duration,
    /// `load_time`, by what it went on: in the order of `Phase::ALL`.
    pub load_phases: [Duration; 8],
    /// The most stack any file took, in bytes.
    pub deepest_stack: usize,
}

impl Report {
    /// Whether the exit code is 0: nothing is wrong, and nothing went unlooked at.
    pub fn is_ok(&self) -> bool {
        self.error_count() == 0 && self.incomplete.is_empty()
    }

    pub fn error_count(&self) -> usize {
        self.diagnostics
            .iter()
            .filter(|d| d.category == Category::Error)
            .count()
    }

    /// Adds the result of checking another project. The diagnostics are left unsorted.
    fn merge(&mut self, other: Report) {
        self.diagnostics.extend(other.diagnostics);
        self.incomplete.extend(other.incomplete);
        self.listed_files.extend(other.listed_files);
        self.has_bun_types_installed |= other.has_bun_types_installed;
        self.files_loaded += other.files_loaded;
        self.files_checked += other.files_checked;
        self.check_time += other.check_time;
        for (phase, more) in self.load_phases.iter_mut().zip(other.load_phases) {
            *phase += more;
        }
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

fn global(code: u32, args: &[impl AsRef<[u8]>]) -> Diagnostic {
    let (category, template) =
        messages::message(code).unwrap_or((Category::Error, "Unknown error."));
    Diagnostic {
        path: Vec::new(),
        start: 0,
        end: 0,
        line: 0,
        column: 0,
        end_line: 0,
        end_column: 0,
        code,
        category,
        text: {
            let mut text = Vec::new();
            messages::format(&mut text, template, args);
            text
        },
        source: Vec::new(),
        source_line: 0,
        related: Vec::new(),
    }
}

/// TypeScript's messages say how to install types with npm.
fn in_terms_of_bun(text: Vec<u8>) -> Vec<u8> {
    const NPM: &[u8] = b"npm i --save-dev ";
    if text.contains_str(NPM) {
        text.replace(NPM, b"bun add -d ")
    } else {
        text
    }
}

/// `said`, of the bytes `start..end` of the file at `path`, which reads `text` and whose lines start at `starts`.
fn located(
    path: &[u8],
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
        path: path.to_vec(),
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

/// The line `offset` is on, from 0, and how many UTF-16 code units come before it there.
fn line_and_character(text: &[u8], starts: &[u32], offset: u32) -> (u32, u32) {
    let offset = offset.min(text.len() as u32);
    let line = starts.partition_point(|&s| s <= offset) - 1;
    let before = &text[starts[line] as usize..offset as usize];
    let units = bun_core::strings::element_length_utf8_into_utf16(before);
    (line as u32, units as u32)
}

fn line_text(text: &[u8], starts: &[u32], line: u32) -> Vec<u8> {
    let from = starts[line as usize] as usize;
    let to = starts
        .get(line as usize + 1)
        .map_or(text.len(), |&s| s as usize);
    text[from..to]
        .trim_end_with(|c| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
        .to_vec()
}

/// The roots `paths` stand for: a file is itself, a directory is what a project with nothing but that directory would include.
fn roots_of_paths(
    disk: &host::Disk,
    cwd: &[u8],
    paths: &[Vec<u8>],
    allow_js: bool,
    errors: &mut Vec<Diagnostic>,
) -> Vec<Vec<u8>> {
    let mut roots = Vec::new();
    for path in paths {
        let path = join(cwd, &path.replace(b"\\", b"/"));
        if disk.is_dir(&path) {
            let compiler = Json::Object(vec![(b"allowJs".to_vec(), Json::Bool(allow_js))]);
            roots.extend(config::without_config(disk, &path, compiler, Vec::new()).files);
        } else if disk.is_file(&path) {
            roots.push(path);
        } else {
            errors.push(global(6053, &[path]));
        }
    }
    roots
}

/// Checks what `request` asks for. `then` is handed the report WHILE ALL THAT WAS LOADED IS STILL THERE. Giving back millions of small pieces
/// of memory one by one takes a while, and the system takes it all back at once: who ends the process does so in `then`. For who returns
/// from it, all is dropped.
pub fn check_then<R>(request: &Request, then: impl FnOnce(Report) -> R) -> R {
    let threads = match request.threads {
        0 => std::thread::available_parallelism().map_or(4, usize::from),
        n => n,
    };
    let disk = host::Disk::new(threads);
    let (mut report, _program) = check_what_is_asked(&disk, request);
    if cfg!(windows) {
        for said in &mut report.diagnostics {
            host::show_drives(&mut said.text);
            let related = said.related.iter_mut();
            related.for_each(|related| host::show_drives(&mut related.text));
        }
    }
    then(report)
}

pub fn check(request: &Request) -> Report {
    check_then(request, |report| report)
}

/// With the report, the program that was checked last.
fn check_what_is_asked(disk: &host::Disk, request: &Request) -> (Report, Option<Box<Program>>) {
    let started = Instant::now();
    let cwd = host::from_native(request.cwd);
    let mut report = Report::default();

    let config_path = match request.project {
        Some(project) => {
            let path = join(&cwd, &project.replace(b"\\", b"/"));
            if disk.is_dir(&path) {
                let inside = join(&path, b"tsconfig.json");
                if !disk.is_file(&inside) {
                    report.diagnostics.push(global(5057, &[path]));
                    return (report, None);
                }
                Some(inside)
            } else if disk.is_file(&path) {
                Some(path)
            } else {
                report.diagnostics.push(global(5058, &[path]));
                return (report, None);
            }
        }
        // The project the first thing named belongs to, or else the one around here.
        None => request
            .paths
            .first()
            .map(|first| join(&cwd, &first.replace(b"\\", b"/")))
            .and_then(|first| {
                let dir = if disk.is_dir(&first) {
                    first
                } else {
                    dirname::<Posix>(&first).to_vec()
                };
                config::find_config(disk, &dir)
            })
            .or_else(|| config::find_config(disk, &cwd)),
    };
    let mut project = match &config_path {
        // Nothing is written, whatever the project says. Without `references` this is `tsc --noEmit`: what is only wrong with where
        // output would go is not looked into. With them it is `tsc -b`, which has no `--noEmit`.
        Some(path) => config::load_overriding(disk, path, &|has_references| {
            overriding_options(request, has_references && request.paths.is_empty())
        }),
        None => {
            let mut options = default_compiler_options();
            if let Json::Object(options) = &mut options {
                for option in request.compiler_options {
                    options.retain(|(name, _)| *name != option.0);
                    options.push((option.0.clone(), option.1.clone()));
                }
            }
            config::without_config(disk, &cwd, options, Vec::new())
        }
    };
    report.config_path.clone_from(&project.config_path);
    let mut named = None;
    if !request.paths.is_empty() {
        let mut roots = roots_of_paths(
            disk,
            &cwd,
            request.paths,
            project.options.allow_js,
            &mut report.diagnostics,
        );
        // The program is the whole project all the same. What one file adds to the global scope, or to a module, is there for every
        // other: a file means the same, and has the same errors, whether it is named or not.
        let mut seen: FxHashSet<&[u8]> = project.files.iter().map(Vec::as_slice).collect();
        let more: Vec<Vec<u8>> = roots
            .iter()
            .filter(|root| seen.insert(root.as_slice()))
            .cloned()
            .collect();
        project.files.extend(more);
        project.options.files.clone_from(&project.files);
        // That the project itself names no files is beside the point.
        project
            .errors
            .retain(|e| e.code != 18003 && e.code != 18002);
        roots.sort_unstable();
        named = Some(roots);
    }
    if named.is_none() && !project.references.is_empty() {
        check_with_references(disk, project, request, report, started)
    } else {
        check_what_is_named(
            disk,
            project,
            request,
            report,
            started,
            named.as_deref(),
            None,
        )
    }
}

struct ReferencedProject {
    project: config::Project,
    /// Indices into the list of projects.
    references: Vec<usize>,
}

/// `Orchestrator`, as far as `GenerateGraph` goes.
struct Graph<'h> {
    host: &'h dyn Host,
    overrides: Vec<(Vec<u8>, Json)>,
    /// `order`: dependencies first.
    projects: Vec<ReferencedProject>,
    /// By configuration file, each of which is loaded once. `completed`: where it is in `projects`. `analyzing`: `None`.
    index_of: FxHashMap<Vec<u8>, Option<usize>>,
    circularity_stack: Vec<Vec<u8>>,
    /// `errors`: TS6202. With one of these nothing is built.
    errors: Vec<Diagnostic>,
    /// `upToDateStatusTypeConfigFileNotFound`, which a task says when it is run.
    not_found: Vec<Diagnostic>,
}

impl Graph<'_> {
    /// `setupBuildTask`: where `project` is in `projects`.
    fn setup_build_task(&mut self, project: config::Project, in_circular_context: bool) -> usize {
        self.index_of.insert(project.config_path.clone(), None);
        self.circularity_stack.push(project.config_path.clone());
        let mut references = Vec::new();
        for reference in &project.references {
            let path = config::resolve_config_file_name_of_project_reference(&reference.path);
            let in_circular_context = in_circular_context || reference.circular;
            match self.index_of.get(&path) {
                Some(Some(index)) => references.push(*index),
                Some(None) if in_circular_context => {}
                Some(None) => {
                    let stack = self.circularity_stack.join(&b'\n');
                    self.errors.push(global(6202, &[stack]));
                }
                None if !self.host.is_file(&path) => self.not_found.push(global(6053, &[path])),
                None => {
                    let over = |_: bool| self.overrides.clone();
                    let referenced = config::load_overriding(self.host, &path, &over);
                    references.push(self.setup_build_task(referenced, in_circular_context));
                }
            }
        }
        self.circularity_stack.pop();
        let index = self.projects.len();
        self.index_of
            .insert(project.config_path.clone(), Some(index));
        self.projects.push(ReferencedProject {
            project,
            references,
        });
        index
    }
}

/// What `tsc -b` checks: `root` and every project it references, each with its own options. Nothing has to be built first: an
/// import from a referenced project resolves to its source, where `tsc` would read the `.d.ts` it emitted.
fn check_with_references(
    host: &dyn Host,
    root: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
) -> (Report, Option<Box<Program>>) {
    let mut graph = Graph {
        host,
        overrides: overriding_options(request, true),
        projects: Vec::new(),
        index_of: FxHashMap::default(),
        circularity_stack: Vec::new(),
        errors: Vec::new(),
        not_found: Vec::new(),
    };
    graph.setup_build_task(root, false);
    let Graph {
        projects,
        index_of,
        mut errors,
        mut not_found,
        ..
    } = graph;
    // `buildOrClean`: "Circularity errors prevent any project from being built".
    if !errors.is_empty() {
        report.diagnostics.append(&mut errors);
        report.load_time = started.elapsed();
        return (report, None);
    }
    report.diagnostics.append(&mut not_found);
    let resolved = |path: &[u8]| Some(&projects[(*index_of.get(path)?)?].project);
    let mut about_references: Vec<Vec<ConfigError>> = (projects.iter())
        .map(|p| {
            (verify_project_references(&p.project, &resolved).iter())
                .map(|(config_path, problem)| ConfigError::of_problem(host, config_path, problem))
                .collect()
        })
        .collect();
    // A file that belongs to a referenced project is checked there, with that project's options.
    let roots: Vec<Vec<Vec<u8>>> = projects.iter().map(|p| p.project.files.clone()).collect();
    // Where each project's declaration files would go, and the directory they mirror. `None`: next to the sources.
    let outputs: Vec<Option<(Vec<u8>, Vec<u8>)>> = projects
        .iter()
        .map(|p| {
            let options = &p.project.options;
            let output_dir = [&options.declaration_dir, &options.out_dir]
                .into_iter()
                .find(|dir| !dir.is_empty())?;
            let root_dir = if options.root_dir.is_empty() {
                dirname::<Posix>(&p.project.config_path)
            } else {
                options.root_dir.as_slice()
            };
            Some((
                output_dir.trim_end_with(|c| c == '/').to_vec(),
                root_dir.trim_end_with(|c| c == '/').to_vec(),
            ))
        })
        .collect();
    let references: Vec<Vec<usize>> = projects.iter().map(|p| p.references.clone()).collect();
    let mut program = None;
    for (index, referenced) in projects.into_iter().enumerate() {
        let mut project = referenced.project;
        if project.files.is_empty() && !project.references.is_empty() {
            // `upToDateStatusTypeSolution`: there is no program. `GetConfigFileParsingDiagnostics` are said all the same.
            project.errors.retain(|e| !e.is_about_options);
            if project.errors.is_empty() {
                continue;
            }
        } else {
            project.errors.append(&mut about_references[index]);
        }
        let mut is_referenced = vec![false; roots.len()];
        let mut pending = references[index].clone();
        while let Some(i) = pending.pop() {
            if !std::mem::replace(&mut is_referenced[i], true) {
                pending.extend(&references[i]);
            }
        }
        project.options.referenced_outputs = (0..roots.len())
            .filter(|&i| is_referenced[i])
            .filter_map(|i| outputs[i].clone())
            .collect();
        let own: FxHashSet<&[u8]> = roots[index].iter().map(Vec::as_slice).collect();
        let owned_elsewhere: FxHashSet<&[u8]> = (0..roots.len())
            .filter(|&i| is_referenced[i])
            .flat_map(|i| roots[i].iter().map(Vec::as_slice))
            .filter(|path| !own.contains(path))
            .collect();
        // Not two programs at a time.
        drop(program.take());
        let checked = check_what_is_named(
            host,
            project,
            request,
            Report::default(),
            Instant::now(),
            None,
            Some(&owned_elsewhere),
        );
        report.merge(checked.0);
        program = checked.1;
        report.projects_checked += 1;
    }
    report.load_time = started.elapsed().saturating_sub(report.check_time);
    sort_and_deduplicate(&mut report.diagnostics);
    (report, program)
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
    check_what_is_named(host, project, request, report, started, None, None).0
}

/// `check_project`. `named`: of all that is loaded, only these files, sorted, and what they refer to is checked.
/// `owned_elsewhere`: files of referenced projects, which are loaded but not checked.
fn check_what_is_named(
    host: &dyn Host,
    mut project: config::Project,
    request: &Request,
    mut report: Report,
    started: Instant,
    named: Option<&[Vec<u8>]>,
    owned_elsewhere: Option<&FxHashSet<&[u8]>>,
) -> (Report, Option<Box<Program>>) {
    let threads = match request.threads {
        0 => std::thread::available_parallelism().map_or(4, usize::from),
        n => n,
    };
    let of_configuration = |error: &ConfigError| {
        let mut said = global(error.code, &error.args);
        for (level, code, args) in &error.chain {
            said.text.push(b'\n');
            for _ in 0..*level {
                said.text.extend_from_slice(b"  ");
            }
            said.text.extend_from_slice(&global(*code, args).text);
        }
        match &error.at {
            Some((path, from, to)) => match host.read(path) {
                Some(text) => located(
                    path,
                    &text,
                    &compute_ecma_line_starts(&text),
                    *from,
                    *to,
                    said,
                ),
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
                text: b"Cannot find TypeScript's standard library (lib.es5.d.ts and the rest), which declares Array, Promise and \
                       everything else that is built in. It comes with the typescript package: bun add -d typescript"
                    .to_vec(),
                code: 0,
                ..global(6053, &[""; 0])
            });
            return (report, None);
        }
    }
    report.has_bun_types_installed = project
        .options
        .effective_type_roots()
        .iter()
        .any(|root| host.is_file(&[&root[..], b"/bun/package.json"].concat()));
    // `"types": ["bun"]` is among what `bun init` writes, and so among what goes where there is no configuration file. It is left out
    // of `default_compiler_options` because what is not installed cannot be asked for (TS2688).
    if report.has_bun_types_installed
        && project.config_path.is_empty()
        && project.options.types.is_none()
    {
        project.options.types = Some(vec![b"bun".to_vec()]);
    }
    let (skip_lib_check, skip_default_lib_check) = (
        project.options.skip_lib_check,
        project.options.skip_default_lib_check,
    );

    let written = std::mem::take(&mut project.compiler_options_as_written);
    let is_true = |name: &[u8]| written.contains(&(name.to_vec(), Json::Bool(true)));
    project.options.drops_what_nothing_refers_to = !request.keeps_everything;
    project.options.has_project_references = !project.references.is_empty();
    let before = host.times();
    host.spent(Phase::Discover, started.elapsed());
    let files = Files::load(host, project.options, &project.files);
    let program = Program::new(std::sync::Arc::new(files));
    report.files_loaded = program.files.modules.len();
    report.load_time = started.elapsed();
    let after = host.times();
    for (i, phase) in report.load_phases.iter_mut().enumerate() {
        *phase = after[i] - before[i];
    }
    if let Some(loaded) = request.loaded {
        loaded(&program);
    }
    if is_true(b"listFiles") || is_true(b"listFilesOnly") {
        let path = |&file: &FileId| program.files.module(file).path.clone();
        report.listed_files = program.files.order.iter().map(path).collect();
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
                // Only what the parser objects to is said of JSON.
                FileKind::Json => module.hir.has_parse_diagnostics,
                _ if module.is_lib => !skip_lib_check && !skip_default_lib_check,
                FileKind::Declaration => !skip_lib_check,
                FileKind::Ts | FileKind::Tsx => true,
            }
        })
        .map(|i| FileId(i as u32))
        .collect();
    let is_reached = named.map(|named| {
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
            .retain(|&f| !owned_elsewhere.contains(program.files.modules[f.idx()].path.as_slice()));
    }
    if let Some(only) = request.only {
        to_check.retain(|&f| program.files.modules[f.idx()].path.contains_str(only));
    }
    if is_true(b"listFilesOnly") && request.stops_where_tsc_does {
        to_check.clear();
    }
    // Program order (`program.files`): an imported file precedes its importers. The start order is determined by the program, not by
    // paths or timing.
    to_check.sort_by_key(|&f| program.files.rank_of_file(f).wrapping_mul(request.order));
    let size = |f: FileId| program.files.modules[f.idx()].hir.source_len;
    report.files_checked = to_check.len();
    if let Some(progress) = request.progress {
        let bytes = to_check
            .iter()
            .map(|f| program.files.modules[f.idx()].hir.source_len as usize)
            .sum();
        progress.bytes_to_check.store(bytes, Ordering::Relaxed);
        progress.to_check.store(to_check.len(), Ordering::Relaxed);
    }
    let found: Guarded<Vec<Diagnostic>> = Guarded::new(Vec::new());
    // `GetDeclarationDiagnostics`
    let emit_diagnostics: Guarded<Vec<Diagnostic>> = Guarded::new(Vec::new());
    let incomplete: Guarded<Vec<Vec<u8>>> = Guarded::new(Vec::new());
    let deepest_stack = AtomicUsize::new(0);
    // The text of the default library is not kept.
    let text_of = |file: FileId| {
        let module = &program.files.modules[file.idx()];
        if module.hir.text.is_empty() {
            host.read(&module.path).unwrap_or_default()
        } else {
            std::borrow::Cow::Borrowed(&module.hir.text[..])
        }
    };
    let show = |file: FileId, errors: Vec<Explained>, found: &Guarded<Vec<Diagnostic>>| {
        if errors.is_empty() {
            return;
        }
        let module = &program.files.modules[file.idx()];
        let text = &text_of(file)[..];
        let starts = compute_ecma_line_starts(text);
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
                            text: related.text.into_bytes(),
                            ..global(0, &[""; 0])
                        };
                        let Some((of, start, end)) = related.at else {
                            return said;
                        };
                        if of == file {
                            return located(&module.path, text, &starts, start, end, said);
                        }
                        let other = &program.files.modules[of.idx()];
                        let text = &text_of(of)[..];
                        located(
                            &other.path,
                            text,
                            &compute_ecma_line_starts(text),
                            start,
                            end,
                            said,
                        )
                    })
                    .collect();
                let said = Diagnostic {
                    related,
                    code: e.code,
                    category: e.category,
                    text: if request.says_it_as_typescript_does {
                        e.text.into_bytes()
                    } else {
                        in_terms_of_bun(e.text.into_bytes())
                    },
                    ..global(0, &[""; 0])
                };
                located(&module.path, text, &starts, e.start, e.end, said)
            })
            .collect();
        if let Some(progress) = request.progress {
            progress.errors.fetch_add(shown.len(), Ordering::Relaxed);
        }
        found.lock().extend(shown);
    };
    let new_checker = |only_syntax: bool| {
        let mut checker = program.checker();
        checker.set_only_syntax(only_syntax);
        // What the thread really has left, whatever thread it is and however it was built.
        checker.set_stack_limit(bun_core::StackCheck::init().remaining());
        checker
    };
    let finish_file = |checker: &mut bun_sema::check::Checker<'_>, file, mut checked: Checked| {
        let declaration = checked.take_declaration_diagnostics();
        show(file, checker.finish_file(file, checked), &found);
        if let Some(declaration) = declaration {
            show(
                file,
                checker.finish_file(file, declaration),
                &emit_diagnostics,
            );
        }
    };
    // What was found in the files that the checker of another file may still report in.
    let unfinished: Guarded<Vec<(FileId, Checked)>> = Guarded::new(Vec::new());
    let check_file = |file: FileId, only_syntax: bool| {
        // Dropped last, after all that was found out about the file.
        let _at_hand = program.files.bring_in(host, file);
        let module = &program.files.modules[file.idx()];
        let mut checker = new_checker(only_syntax);
        let checked = checker.check_file(file);
        if let Some(after_file) = request.after_file
            && !only_syntax
        {
            after_file(&mut checker, file);
        }
        deepest_stack.fetch_max(checker.deepest_stack(), Ordering::Relaxed);
        // What was found stands. What was not may be missing, and that is said.
        if checker.ran_out_of_stack() {
            incomplete.lock().push(module.path.clone());
        }
        // Nothing refers to a file that is only at hand for now, and what does not parse is nobody else's business.
        if only_syntax || module.is_transient {
            finish_file(&mut checker, file, checked);
        } else {
            unfinished.lock().push((file, checked));
        }
    };
    let finish_files = || {
        let unfinished: Vec<Guarded<Option<(FileId, Checked)>>> = unfinished
            .lock()
            .drain(..)
            .map(|one| Guarded::new(Some(one)))
            .collect();
        for_each_parallel(threads, unfinished.len(), &|i| {
            let (file, checked) = unfinished[i].lock().take().unwrap();
            if !program.has_nothing_to_finish(file, &checked) {
                finish_file(&mut new_checker(false), file, checked);
            }
        });
    };
    let take = |i: usize| {
        check_file(to_check[i], false);
        if let Some(progress) = request.progress {
            progress.checked.fetch_add(1, Ordering::Relaxed);
            progress
                .bytes_checked
                .fetch_add(size(to_check[i]) as usize, Ordering::Relaxed);
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
    let check_files = || {
        for_each_parallel(threads, to_check.len(), &take);
        finish_files();
    };
    // `EmitFilesAndReportErrors` calls `Emit` after collecting diagnostics, even if there are errors, and the declaration transformer
    // reports under `noEmit` too (`emitDeclarationFile`). `HandleNoEmitOnError` skips `Emit`, and so does `noEmit` on an incremental
    // program. Every `tsc -b` program is incremental. Otherwise this models `tsc -p --noEmit`.
    let options = &program.files.options;
    let emits_despite_errors = options.emits_declarations
        && !options.no_emit_on_error
        && !match owned_elsewhere {
            Some(_) => options.no_emit,
            None => options.is_incremental,
        };
    let emit_on_early_exit = || -> Vec<Diagnostic> {
        if emits_despite_errors {
            check_files();
            found.lock().clear();
        }
        std::mem::take(&mut *emit_diagnostics.lock())
    };
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
            let syntactic = std::mem::take(&mut *found.lock());
            if !syntactic.is_empty() {
                report.diagnostics.extend(syntactic);
                report.files_checked = 0;
                report.diagnostics.extend(emit_on_early_exit());
                break 'stages;
            }
        }
        report.diagnostics.append(&mut about_options);
        if stops {
            report.diagnostics.extend(global_errors());
            if report.diagnostics.len() > said_at_any_rate {
                report.files_checked = 0;
                report.diagnostics.extend(emit_on_early_exit());
                break 'stages;
            }
        }
        check_files();
        report.diagnostics.append(&mut found.lock());
        report.diagnostics.extend(global_errors());
        // `GetDiagnosticsOfAnyProgram` collects them itself if there are no other errors. This list also contains suggestions.
        let is_error = |d: &Diagnostic| d.category == Category::Error;
        if !stops
            || emits_despite_errors
            || !report.diagnostics[said_at_any_rate..].iter().any(is_error)
        {
            report.diagnostics.append(&mut emit_diagnostics.lock());
        }
        // `iterateBaseline`: whoever writes something for every file does so for the files that are not checked as well.
        if let Some(after_file) = request.after_file {
            let mut is_checked = vec![false; program.files.modules.len()];
            for file in &to_check {
                is_checked[file.idx()] = true;
            }
            for i in 0..program.files.modules.len() {
                let (file, module) = (FileId(i as u32), &program.files.modules[i]);
                if module.is_lib
                    || !matches!(module.hir.kind, FileKind::Declaration | FileKind::Json)
                    || is_checked[i]
                {
                    continue;
                }
                let _at_hand = program.files.bring_in(host, file);
                let mut checker = program.checker();
                checker.set_stack_limit(bun_core::StackCheck::init().remaining());
                after_file(&mut checker, file);
            }
        }
    }
    report.deepest_stack = deepest_stack.into_inner();
    report.incomplete = std::mem::take(&mut *incomplete.lock());
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
    (report, Some(Box::new(program)))
}
