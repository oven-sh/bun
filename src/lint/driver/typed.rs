//! Lints the files whose rules need types.
//!
//! Each file is type checked with the `tsconfig.json` an editor would use for it, or with the first project listed in
//! `parserOptions.project` that includes it. It's checked the way an editor does it: imported files are only examined
//! as far as their types are needed, and a referenced project is read from its sources. A file is linted right after
//! it's checked, by the same thread, while its types are still in memory. Type errors aren't reported, because that's
//! what `bun check` is for, unless oxlint's `--type-check` is passed.
//!
//! # Fixes
//!
//! ESLint lints a file again after fixing it, up to ten times. This does the same for all files at once: changed files
//! are checked again, with their new text instead of what's on disk, until nothing changes. Files that import them
//! aren't linted again.

use crate::lint::Context;
use crate::results::{Counts, FileResult};
use crate::run::Environment;
use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::context::Severity;
use bun_lint::glob::Picomatch;
use bun_lint::linter::config::strings_of;
use bun_lint::linter::globals::{InferredGlobal, InferredGlobals, ProgramGlobals};
use bun_lint::linter::{
    Details, LintMessage, LintOptions, LintResult, MAX_AUTOFIX_PASSES, ResolvedConfig, RuleId,
    apply_fixes, breaks_syntax,
};
use bun_sema::json::Json;
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::{inside, is_same_path, to_file_name_lower_case};
use bun_sema::util::{FxHashMap, FxHashSet};
use bun_sema_driver::host::{AlreadyRead, Provided, as_read, from_native, is_bundled, to_native};
use bun_sema_driver::{Category, Diagnostic, Libs, RejectedProgram, WithoutInclude};
use bun_threading::Guarded;
use std::sync::{Arc, OnceLock};

/// A file to lint.
pub(crate) struct Typed<'t> {
    pub(crate) path: &'t [u8],
    pub(crate) config: &'t Arc<ResolvedConfig>,
    /// Its text, if it comes from standard input instead of the disk.
    pub(crate) text: Option<Vec<u8>>,
}

/// A file's lint result, and its text if that's needed.
type Linted = (LintResult, Option<Vec<u8>>);

/// Type checks the programs that `files` belong to and lints the files at `indices`. `None` for a file that's in no
/// program, or that can't be linted there.
fn check_and_lint(
    context: &Context,
    environment: &Environment,
    files: &[Typed],
    indices: &[usize],
    already_read: AlreadyRead,
    is_first_pass: bool,
) -> Vec<Option<Linted>> {
    // tsgolint picks each file's project itself. oxlint doesn't pass it `--tsconfig`.
    let (like_oxlint, others): (Vec<usize>, Vec<usize>) =
        (0..indices.len()).partition(|&at| files[indices[at]].config.language.is_oxlint);
    if like_oxlint.is_empty() {
        return check_and_lint_in(
            context,
            environment,
            files,
            indices,
            already_read,
            Project::Nearest,
            is_first_pass,
        )
        .0;
    }
    let mut linted: Vec<Option<Linted>> = indices.iter().map(|_| None).collect();
    // Returns the files that no project includes, and whether any of them wasn't linted.
    let mut check = |positions: &[usize], already_read: AlreadyRead, project: Project<'_>| {
        let some: Vec<usize> = positions.iter().map(|&at| indices[at]).collect();
        let (batch_results, program_kind) = check_and_lint_in(
            context,
            environment,
            files,
            &some,
            already_read,
            project,
            is_first_pass,
        );
        let (mut in_no_project, mut has_unlinted) = (Vec::new(), false);
        for ((&at, linted_file), program_kind) in
            positions.iter().zip(batch_results).zip(program_kind)
        {
            let is_unlinted = linted_file.is_none() && program_kind != ProgramKind::ProjectRejected;
            if is_unlinted || program_kind == ProgramKind::InNoProject {
                in_no_project.push(at);
            }
            has_unlinted |= is_unlinted;
            linted[at] = linted_file;
        }
        (in_no_project, has_unlinted)
    };
    if !others.is_empty() {
        check(&others, already_read.clone(), Project::Nearest);
    }
    let config = inside(
        &from_native(&environment.cwd),
        b"tsconfig.of-no-project.json",
    );
    let mut already_read = already_read;
    already_read.insert(config.clone(), INFERRED_PROJECT_OPTIONS.to_vec());
    let (in_no_project, has_unlinted) = check(
        &like_oxlint,
        already_read.clone(),
        Project::Including(&config),
    );
    // A file that its project couldn't lint also counts as in no project. All such files form one program, so it's
    // built again.
    if has_unlinted {
        check(&in_no_project, already_read, Project::This(&config));
    }
    linted
}

/// The kind of program a file was checked in.
#[derive(Clone, Copy, PartialEq)]
enum ProgramKind {
    InAProject,
    /// In the program made of the files that no project includes.
    InNoProject,
    /// Its project was rejected, so it's linted without types.
    ProjectRejected,
}

/// tsgolint's `CreateInferredProjectProgram`: one program for all files that no project includes, including JavaScript.
const INFERRED_PROJECT_OPTIONS: &[u8] = br#"{"compilerOptions":{"allowJs":true,"module":"esnext","moduleResolution":"bundler","target":"es2022","jsx":"react-jsx","allowImportingTsExtensions":true,"strictNullChecks":true,"strictFunctionTypes":true,"esModuleInterop":true,"resolveJsonModule":true,"noEmit":true},"files":[]}"#;

/// Selects the project a file is checked in.
#[derive(Clone, Copy)]
enum Project<'a> {
    /// The one an editor would pick, or `-p`. A file that no project includes goes into the nearest config file's
    /// project.
    Nearest,
    /// The one tsgolint would pick. See `PlanOptions::requires_including_project`. A file that no project includes
    /// goes into this config file's project.
    Including(&'a [u8]),
    /// This config file's project.
    This(&'a [u8]),
}

/// Maps a `tspath.Path` to the index of a file to lint. On a case-insensitive file system, a program may spell a file
/// differently from the argument or working directory that led to it.
struct ByPath {
    /// Keyed by the path in the checker's format.
    exact: FxHashMap<Vec<u8>, usize>,
    /// The same map with lowercase keys. Built on the first lookup that misses in `exact`.
    folded: OnceLock<FxHashMap<Vec<u8>, usize>>,
}

impl ByPath {
    /// `name` is a program's name for a file.
    fn get(&self, name: &[u8], is_case_sensitive: bool) -> Option<usize> {
        if let Some(&at) = self.exact.get(name) {
            return Some(at);
        }
        if is_case_sensitive {
            return None;
        }
        let folded = self.folded.get_or_init(|| {
            // If two paths differ only in case, the first one wins.
            let exact = bun_lint::utils::sort::collect_sorted_by_key(&self.exact, |it| {
                std::cmp::Reverse(*it.1)
            });
            (exact.into_iter())
                .map(|(path, &at)| (to_file_name_lower_case(path), at))
                .collect()
        });
        folded.get(&to_file_name_lower_case(name)).copied()
    }
}

/// `parserOptions.project`, when it lists config files.
struct Listed<'t> {
    by_path: &'t ByPath,
    /// For each file in `by_path`, the index of its list in `lists`.
    list_indices: Vec<usize>,
    lists: Vec<Vec<Vec<u8>>>,
}

impl bun_sema_driver::ListedProjects for Listed<'_> {
    fn of(&self, path: &[u8], is_case_sensitive: bool) -> &[Vec<u8>] {
        let at = self.by_path.get(path, is_case_sensitive);
        at.map_or(&[], |at| &self.lists[self.list_indices[at]])
    }
}

impl<'t> Listed<'t> {
    fn new(by_path: &'t ByPath, files: &[Typed], indices: &[usize], cwd: &[u8]) -> Listed<'t> {
        let cwd = crate::paths::from_native(cwd);
        // Files with the same config share a list, and so do configs with the same options.
        let mut by_config: FxHashMap<*const ResolvedConfig, usize> = FxHashMap::default();
        let mut by_text: FxHashMap<Vec<u8>, usize> = FxHashMap::default();
        let mut lists = Vec::new();
        let list_indices = indices.iter().map(|&index| {
            let config = files[index].config;
            *by_config.entry(Arc::as_ptr(config)).or_insert_with(|| {
                let options = &config.language.parser_options;
                let mut text = Vec::new();
                for name in [
                    &b"project"[..],
                    b"projectService",
                    b"tsconfigRootDir",
                    b"projectFolderIgnoreList",
                ] {
                    match options.get(name) {
                        Some(value) => value.stringify(&mut text),
                        None => text.extend_from_slice(b"null"),
                    }
                    text.push(b'\n');
                }
                *by_text.entry(text).or_insert_with(|| {
                    lists.push(resolve_project_list(options, &cwd));
                    lists.len() - 1
                })
            })
        });
        Listed {
            by_path,
            list_indices: list_indices.collect(),
            lists,
        }
    }
}

/// typescript-estree 8.71's `resolveProjectList`: entries that aren't globs come first, in order, wherever they are in
/// the list, followed by each glob's matches. Paths are in the checker's format. Empty if `project` lists nothing or
/// `projectService` overrides it.
fn resolve_project_list(options: &Json, cwd: &[u8]) -> Vec<Vec<u8>> {
    let project_entries = strings_of(options.get(b"project"));
    if project_entries.is_empty() || options.get(b"projectService").is_some_and(Json::is_truthy) {
        return Vec::new();
    }
    let root = match options.get(b"tsconfigRootDir").and_then(Json::as_str) {
        Some(root) => crate::paths::resolve(cwd, &crate::paths::portable(cwd, root)),
        None => cwd.to_vec(),
    };
    let ignored = match options.get(b"projectFolderIgnoreList") {
        Some(list @ Json::Array(_)) => strings_of(Some(list)),
        _ => vec![&b"**/node_modules/**"[..]],
    };
    let (patterns, names): (Vec<&[u8]>, Vec<&[u8]>) =
        (project_entries.iter().copied()).partition(|it| bun_glob::scan::is_glob(it));
    let names = names.iter();
    let mut list: Vec<Vec<u8>> = names
        .map(|it| crate::paths::resolve(&root, &crate::paths::portable(&root, it)))
        .collect();
    for pattern in patterns {
        list.extend(files_matching(&root, pattern, &ignored));
    }
    let mut seen = bun_sema::util::FxHashSet::default();
    list.retain(|it| seen.insert(it.clone()));
    let to_checker_format = |it: Vec<u8>| from_native(&crate::paths::to_native(it));
    list.into_iter().map(to_checker_format).collect()
}

/// Returns what tinyglobby finds for `pattern` under `root`, sorted. tinyglobby itself returns them in the order it
/// reads the directories. A symlink to a directory isn't followed.
fn files_matching(mut root: &[u8], pattern: &[u8], ignored: &[&[u8]]) -> Vec<Vec<u8>> {
    let mut pattern = pattern.strip_prefix(b"./").unwrap_or(pattern);
    // The search starts as far up as the pattern's leading `../` go.
    while let Some(rest) = pattern.strip_prefix(b"../") {
        (root, pattern) = (crate::paths::dirname(root), rest);
    }
    let read = |it: &[u8]| {
        bun_glob::Pattern::with_dots(
            &bun_lint::glob::from_picomatch(it, Picomatch::Micromatch),
            bun_glob::Dots::Hide,
        )
    };
    let pattern = read(pattern);
    let ignored: Vec<bun_glob::Pattern> = ignored.iter().map(|it| read(it)).collect();
    let is_ignored = |relative: &[u8]| ignored.iter().any(|it| it.matches(relative));
    let mut found = Vec::new();
    // Paths relative to `root`. A loop instead of recursion, because directories can be nested to any depth.
    let mut pending: Vec<Vec<u8>> = vec![Vec::new()];
    while let Some(directory) = pending.pop() {
        let path = crate::paths::resolve(root, &directory);
        let Some(listing) = crate::fs::list(&crate::paths::to_native(path)) else {
            continue;
        };
        for entry in listing.entries {
            let relative = match directory.is_empty() {
                true => entry.name,
                false => [&directory[..], b"/", &entry.name].concat(),
            };
            if entry.is_directory {
                let inside = [&relative[..], b"/"].concat();
                if pattern.may_match_inside(&relative) && !is_ignored(&inside) {
                    pending.push(relative);
                }
            } else if pattern.matches(&relative) && !is_ignored(&relative) {
                let path = crate::paths::resolve(root, &relative);
                if !entry.is_link || crate::fs::is_file(&crate::paths::to_native(path.clone())) {
                    found.push(path);
                }
            }
        }
    }
    bun_lint::utils::sort::sort(&mut found);
    found
}

/// The globals of a program that's loaded anyway.
struct LoadedProgramGlobals {
    /// For `None`, see `Files::global_names`.
    names: Option<Vec<InferredGlobal>>,
    checks_javascript: bool,
    /// Files that are in the program only because they're being linted, by the program's name for them. The project
    /// doesn't include them, so they weren't written for its libraries.
    added: FxHashSet<Vec<u8>>,
}

impl LoadedProgramGlobals {
    fn new(program: &Files<'_>) -> LoadedProgramGlobals {
        let inferred = |it: bun_sema::program::GlobalName| InferredGlobal {
            name: it.name,
            is_value: it.is_value,
            is_type: it.is_type,
            is_writable: it.is_writable,
        };
        let names = program.global_names();
        let options = program.options;
        let added = options.own_roots.and_then(|own| options.files.get(own..));
        LoadedProgramGlobals {
            names: names.map(|it| it.into_iter().map(inferred).collect()),
            checks_javascript: options.check_js == Some(true),
            added: added.unwrap_or_default().iter().cloned().collect(),
        }
    }
}

/// [`LoadedProgramGlobals`]'s globals for one file.
struct FileGlobals<'p>(Option<ProgramGlobals<'p>>);

impl InferredGlobals for FileGlobals<'_> {
    fn of(&self, _: &[u8]) -> Option<ProgramGlobals<'_>> {
        self.0
    }
}

fn check_and_lint_in(
    context: &Context,
    environment: &Environment,
    files: &[Typed],
    indices: &[usize],
    already_read: AlreadyRead,
    project: Project<'_>,
    is_first_pass: bool,
) -> (Vec<Option<Linted>>, Vec<ProgramKind>) {
    let by_path = ByPath {
        exact: indices
            .iter()
            .enumerate()
            .map(|(at, &index)| (from_native(files[index].path), at))
            .collect(),
        folded: OnceLock::new(),
    };
    let mut results: Guarded<Vec<Option<Linted>>> =
        Guarded::new(indices.iter().map(|_| None).collect());
    let options = context.lint_options();
    // Reads a TypeScript library file's text, which the checker doesn't keep.
    let read_library = |path: &[u8], then: &mut dyn FnMut(&[u8])| match environment.libs {
        Libs::Bundled(libs) if is_bundled(path) => {
            if let Some(text) = (libs.read)(crate::paths::basename(path)) {
                then(&text);
            }
        }
        Libs::Bundled(_) | Libs::Directory(_) => {
            if let Ok(text) = crate::fs::read(to_native(path)) {
                then(&text);
            }
        }
    };
    // Keyed by config file.
    let program_globals: Guarded<Vec<(Vec<u8>, Arc<LoadedProgramGlobals>)>> =
        Guarded::new(Vec::new());
    let mut program_kinds = Guarded::new(vec![ProgramKind::InAProject; indices.len()]);
    let after_file = |checker: &mut bun_sema::check::Checker<'_, '_>, file: FileId| {
        let program = checker.p.files;
        let name = program.module(file).file_name();
        let Some(at) = by_path.get(name, program.is_case_sensitive) else {
            return;
        };
        let (path, config) = (files[indices[at]].path, files[indices[at]].config);
        let project_of_file = &program.options.config_path;
        let is_in_a_project = match project {
            Project::This(_) => false,
            Project::Including(rest)
                if is_same_path(project_of_file, rest, program.is_case_sensitive) =>
            {
                program_kinds.lock()[at] = ProgramKind::InNoProject;
                false
            }
            Project::Including(_) | Project::Nearest => !project_of_file.is_empty(),
        };
        let is_javascript = bun_sema::resolve::is_javascript(name);
        let infers = config.language.infers_globals.is_for(is_javascript);
        let loaded_globals = (infers && is_in_a_project).then(|| {
            let mut known = program_globals.lock();
            if let Some(found) = known.iter().find(|it| it.0 == *project_of_file) {
                return Arc::clone(&found.1);
            }
            let made = Arc::new(LoadedProgramGlobals::new(program));
            known.push((project_of_file.clone(), Arc::clone(&made)));
            made
        });
        let loaded_globals = loaded_globals
            .as_ref()
            .filter(|it| !it.added.contains(name));
        let file_globals = FileGlobals(loaded_globals.and_then(|it| {
            Some(ProgramGlobals {
                names: it.names.as_deref()?,
                checks_javascript: it.checks_javascript,
            })
        }));
        let started = context.timing.now();
        let linted = bun_lint::types::with_file_and_modules(
            checker,
            file,
            Some(path),
            &config.language,
            Some(&read_library),
            Some(context.modules),
            Some(context.formatter),
            Some(&file_globals),
            |file| {
                let text = file.text();
                let parse_again = |then: &mut dyn for<'f> FnMut(&'f File<'f>)| {
                    context.parse_again(path, text, config, then);
                };
                let options = LintOptions {
                    parse_again: Some(&parse_again),
                    ..options
                };
                let mut result = context.linter.lint(file, config, &options);
                if file.is_too_large_for_flow_analysis() {
                    result.messages.insert(0, too_large_for_flow_analysis());
                }
                if config.language.is_oxlint {
                    crate::lint::unused_directives_as_oxlint(&mut result, false);
                }
                context.promote_suggestions(&mut result);
                // After the first pass, only files that were fixed are linted.
                context.count_redeclarations(file, &mut result, !is_first_pass);
                // The type checker's errors are only known once all files are checked.
                let is_reported = !result.messages.is_empty()
                    || !result.suppressed.is_empty()
                    || context.checks_types;
                let text = (is_reported && (context.keeps_text || context.fixes()))
                    .then(|| file.text().to_vec());
                (result, text)
            },
        );
        context.timing.add(&context.timing.rules, started);
        // A checker task can run more than once. The last run wins.
        match linted {
            Some(linted) => results.lock()[at] = Some(linted),
            // It'll be linted without types. If the tree is too deep for the parser, the linter reports that itself.
            None if !checker.hir(file).ran_out_of_stack && checker.bound(file).ran_out_of_stack => {
                context.out_of_stack.lock().push(path.to_vec());
            }
            None => {}
        }
    };
    let command_line = bun_sema_driver::parse_command_line(&[b"--skipLibCheck"], &environment.cwd);
    let paths: Vec<Vec<u8>> = indices
        .iter()
        .map(|&index| files[index].path.to_vec())
        .collect();
    let listed = matches!(project, Project::Nearest)
        .then(|| Listed::new(&by_path, files, indices, &environment.cwd));
    let request = bun_sema_driver::Request {
        cwd: &environment.cwd,
        project: match project {
            Project::This(config) | Project::Including(config) => Some(config),
            Project::Nearest => context.options.tsconfig.as_deref(),
        },
        listed_projects: (listed.as_ref()).map(|it| it as &dyn bun_sema_driver::ListedProjects),
        build: false,
        errors: &[],
        paths: &paths,
        are_entry_points: false,
        script_kinds: &[],
        script_kinds_by_extension: &[],
        conditions: &[],
        compiler_options: &command_line.compiler_options,
        threads: context.options.threads,
        libs: environment.libs,
        progress: None,
        order: 1,
        plan_options: bun_sema_driver::PlanOptions {
            after_file_only_for_checked_files: true,
            // Like an editor, which is how typescript-eslint's `projectService` works.
            checks_only_requested_paths: true,
            reads_sources_of_references: true,
            uses_project_directory_as_cwd: true,
            skips_file_diagnostics: !context.checks_types,
            requires_including_project: matches!(project, Project::Including(_)),
            project_is_fallback: matches!(project, Project::Including(_)),
            memory: environment.memory,
            shares_every_file: true,
            rejects_broken_configurations: matches!(project, Project::Including(_)),
            // typescript-eslint uses the project's own compiler. tsgolint bundles its own library files.
            prefers_project_typescript_libs: matches!(project, Project::Nearest),
            ..Default::default()
        },
        // A syntax error in one file doesn't stop the others from being linted.
        stops_like_tsc: false,
        uses_typescript_wording: false,
        after_file: Some(&after_file),
    };
    let provided = Provided {
        already_read,
        keeps_byte_order_marks: true,
        ..Default::default()
    };
    let (
        is_case_sensitive,
        unreadable,
        diagnostics,
        incomplete,
        rejected_projects,
        without_include,
    ) = bun_sema_driver::check_provided_then(&request, provided, |report| {
        (
            report.is_case_sensitive,
            report.unreadable,
            report.diagnostics,
            report.incomplete,
            report.rejected_programs,
            report.without_include,
        )
    });
    // The later passes of `--fix` lint some of the same files again.
    if is_first_pass {
        let mut noted = context.without_include.lock();
        for program in without_include {
            let config_path = to_native(&program.config_path).to_vec();
            // Each kind of config loads the program for its own files.
            match noted.iter_mut().find(|it| it.config_path == config_path) {
                Some(known) => {
                    known.requested_files += program.requested_files;
                    known.load_time += program.load_time;
                }
                None => noted.push(WithoutInclude {
                    config_path,
                    // Spelled the way the caller passed it.
                    example: match by_path.get(&program.example, is_case_sensitive) {
                        Some(at) => files[indices[at]].path.to_vec(),
                        None => to_native(&program.example).to_vec(),
                    },
                    ..program
                }),
            }
        }
    }
    // These files belong to a project, so they don't go into the program for files that no project includes. They're
    // linted without types.
    let mut program_kinds = std::mem::take(program_kinds.get_mut());
    for rejected in &rejected_projects {
        for path in &rejected.files {
            if let Some(at) = by_path.get(path, is_case_sensitive) {
                program_kinds[at] = ProgramKind::ProjectRejected;
            }
        }
        note_invalid_tsconfig(context, rejected);
    }
    // The linter itself reports code that's nested too deeply for the parser.
    let out_of_stack = incomplete.into_iter().filter(|it| !it.is_nested_too_deeply);
    (context.out_of_stack.lock()).extend(out_of_stack.map(|it| to_native(&it.path).to_vec()));
    let mut results = std::mem::take(results.get_mut());
    // Each of these was checked and linted as an empty file. Linting it without types reports why it can't be read.
    for path in &unreadable {
        let at = by_path.get(path, is_case_sensitive);
        if let Some(result) = at.and_then(|at| results.get_mut(at)) {
            *result = None;
        }
    }
    if context.checks_types {
        for diagnostic in diagnostics
            .iter()
            .filter(|it| it.category == Category::Error)
        {
            let at = by_path.get(&diagnostic.path, is_case_sensitive);
            if let Some((result, _)) = at.and_then(|at| results.get_mut(at)?.as_mut()) {
                result.messages.push(type_error(diagnostic));
            }
        }
        for (result, _) in results.iter_mut().flatten() {
            LintMessage::sort(&mut result.messages);
        }
    }
    (results, program_kinds)
}

/// True if nearly all the time went into files that weren't requested: at least a thousand, and at least a hundred per
/// linted file. That happens with a `tsconfig.json` at the top of a repository when a file isn't included by its own
/// package's project.
pub(crate) fn is_out_of_proportion(program: &WithoutInclude) -> bool {
    program.included >= 1000 && program.included >= 100 * program.requested_files
}

/// Reports each error that stops tsgolint from building a program (`CreateProgram`) the way oxlint does: "Invalid
/// tsconfig", with TypeScript's text as the help, at TypeScript's location if it has one, otherwise in the config file
/// without a location.
fn note_invalid_tsconfig(context: &Context, rejected: &RejectedProgram) {
    let mut noted = context.invalid_tsconfigs.lock();
    // Each pass of `--fix` finds it again.
    if noted.config_paths.contains(&rejected.config_path) {
        return;
    }
    noted.config_paths.push(rejected.config_path.clone());
    let noted = &mut noted.results;
    for diagnostic in &rejected.diagnostics {
        let has_location = !diagnostic.path.is_empty();
        let path = to_native(match has_location {
            true => &diagnostic.path,
            false => &rejected.config_path,
        });
        // `GetDiagnosticMessage`: without the chained messages.
        let text = &diagnostic.text[..];
        let text = &text[..strings::index_of_char_usize(text, b'\n').unwrap_or(text.len())];
        let mut help = bstr::BStr::new(text).to_string();
        // `enhanceHelpDiagnosticMessage`
        if strings::contains(text, b"Please remove it from your configuration.") {
            help.push_str(
                "\nSee https://github.com/oxc-project/tsgolint/issues/351 for more information.",
            );
        }
        // The `stylish`, `unix` and `json` formats don't show help text, so outside oxlint mode the message includes
        // it.
        let is_oxlint = context.oxlint_config.is_some();
        let message = LintMessage {
            rule_id: Some(RuleId::Unknown(b"typescript/tsconfig-error"[..].into())),
            severity: Severity::Error,
            message: match is_oxlint {
                true => b"Invalid tsconfig".to_vec(),
                false => [&b"Invalid tsconfig: "[..], text].concat(),
            },
            line: diagnostic.line,
            column: diagnostic.column,
            end: has_location.then_some((diagnostic.end_line, diagnostic.end_column)),
            details: is_oxlint.then(|| {
                Box::new(Details {
                    help: help.into(),
                    ..Details::default()
                })
            }),
            ..LintMessage::default()
        };
        let at = match noted.iter().position(|it| it.path == path) {
            Some(at) => at,
            None => {
                noted.push(FileResult {
                    messages: Vec::new(),
                    text: crate::git::read(context.only, &crate::paths::from_native(path)).ok(),
                    ..FileResult::ignored(path.to_vec(), b"")
                });
                noted.len() - 1
            }
        };
        let result = &mut noted[at];
        // An error that two programs inherit from a shared base config is reported once per program.
        result.messages.push(message);
        // `SortAndDeduplicateDiagnostics`: those without a location first, sorted by text.
        let help_of = |it: &LintMessage| it.details.as_ref().map(|it| it.help.clone());
        bun_lint::utils::sort::sort_by(&mut result.messages, |a, b| {
            (a.line, a.column, help_of(a)).cmp(&(b.line, b.column, help_of(b)))
        });
        result.counts = Counts::of(&result.messages);
    }
}

/// `Context::invalid_tsconfigs`
#[derive(Default)]
pub(crate) struct InvalidTsconfigs {
    /// One result per file.
    pub(crate) results: Vec<FileResult>,
    /// The config files of the programs that `results` covers.
    config_paths: Vec<Vec<u8>>,
}

/// Converts a type checker error the way oxlint does: `typescript(TS2322)`, with the first line of the text. No comment
/// can disable it.
fn type_error(diagnostic: &Diagnostic) -> LintMessage {
    let text = &diagnostic.text[..];
    let end = strings::index_of_char_usize(text, b'\n').unwrap_or(text.len());
    // TypeScript strips the byte order mark, but the text checked here keeps it. It doesn't count as a character of the
    // first line.
    let has_mark = diagnostic.source_line == 1
        && (diagnostic.source.first()).is_some_and(|it| it.starts_with(b"\xEF\xBB\xBF"));
    let column = |line: u32, column: u32| match has_mark && line == 1 {
        true => column.saturating_sub(1).max(1),
        false => column,
    };
    LintMessage {
        rule_id: Some(RuleId::Unknown(
            format!("typescript/TS{}", diagnostic.code)
                .into_bytes()
                .into(),
        )),
        message: text[..end].to_vec(),
        line: diagnostic.line,
        column: column(diagnostic.line, diagnostic.column),
        end: Some((
            diagnostic.end_line,
            column(diagnostic.end_line, diagnostic.end_column),
        )),
        ..LintMessage::default()
    }
}

/// True if [`type_error`] made `message`.
pub(crate) fn is_type_error(message: &LintMessage) -> bool {
    message.message_id.is_none()
        && matches!(&message.rule_id, Some(RuleId::Unknown(id)) if id.starts_with(b"typescript/TS"))
}

/// The warning for a file where
/// [`File::is_too_large_for_flow_analysis`](bun_lint::ast::File::is_too_large_for_flow_analysis) is true.
/// typescript-eslint reports nothing.
fn too_large_for_flow_analysis() -> LintMessage {
    LintMessage {
        severity: Severity::Warn,
        message: b"This file is too large for control flow analysis. Reports from rules that need type information may be wrong or incomplete."
            .to_vec(),
        line: 1,
        column: 1,
        ..LintMessage::default()
    }
}

/// The state of ESLint's `verifyAndFix` loop for one file.
#[derive(Default)]
struct Fixing {
    /// `None` means the text on disk.
    current: Option<Vec<u8>>,
    previous: Option<Vec<u8>>,
    passes: usize,
    is_fixed: bool,
    /// Number of fixes applied to get `current`.
    fixes: usize,
    /// No more fixes are applied. Only the messages for `current` are still needed.
    is_done: bool,
    /// The rules whose fixes the last pass applied, then `is_fixed` and `fixes` as they were before that pass.
    last_pass: Option<(Vec<RuleId>, bool, usize)>,
    /// [`LintResult::tolerated_errors`] of `previous`.
    tolerated_before: usize,
}

/// Lints `files` with types. `None` for a file that has to be linted without them.
pub(crate) fn lint(
    context: &Context,
    environment: &Environment,
    files: &[Typed],
    on_circular_fixes: &dyn Fn(&[u8]),
) -> Vec<Option<FileResult>> {
    let mut done: Vec<Option<FileResult>> = files.iter().map(|_| None).collect();
    let state = |file: &Typed| Fixing {
        current: file.text.clone(),
        ..Fixing::default()
    };
    let mut states: Vec<Fixing> = files.iter().map(state).collect();
    let mut pending: Vec<usize> = (0..files.len()).collect();
    let mut staged = (context.only).map_or_else(AlreadyRead::default, |it| it.already_read(true));
    // Also add each staged text under the path the file is linted as, which may contain a symlink.
    staged.extend(files.iter().filter_map(|file| {
        let text = context.only?.staged_text(file.path)?.to_vec();
        Some((from_native(file.path), as_read(file.path, text, true)))
    }));
    let mut is_first_pass = true;
    while !pending.is_empty() {
        let changed = states
            .iter()
            .zip(files)
            .filter_map(|(state, file)| Some((from_native(file.path), state.current.clone()?)));
        let changed = staged.clone().into_iter().chain(changed).collect();
        let linted = check_and_lint(
            context,
            environment,
            files,
            &pending,
            changed,
            is_first_pass,
        );
        is_first_pass = false;
        let mut next = Vec::new();
        for (index, linted) in pending.iter().copied().zip(linted) {
            let (file, state) = (&files[index], &mut states[index]);
            let (mut result, text) = match (linted, &state.current) {
                (Some(linted), _) => linted,
                // It was in a program before it was fixed.
                (None, Some(current)) => (
                    context.verify_pass(file.path, current, file.config, state.previous.is_some()),
                    Some(current.clone()),
                ),
                (None, None) => continue,
            };
            // Revert the last pass's fixes.
            if breaks_syntax(&result, state.tolerated_before)
                && let (Some(before), Some((rules, was_fixed, fixes))) =
                    (state.previous.take(), state.last_pass.take())
            {
                context.note_broken_fixes(file.path, rules);
                *state = Fixing {
                    current: Some(before),
                    is_fixed: was_fixed,
                    fixes,
                    is_done: true,
                    ..Fixing::default()
                };
                next.push(index);
                continue;
            }
            let mut finish = |result: LintResult, text: Option<Vec<u8>>, fixed: (bool, usize)| {
                let (is_fixed, fixes) = fixed;
                // Without a text there's nothing to write.
                let is_fixed = is_fixed && text.is_some();
                let mut result = context.result(
                    crate::paths::to_native(file.path.to_vec()),
                    result,
                    text.unwrap_or_default(),
                    is_fixed,
                    file.config,
                );
                result.had_types = true;
                result.fixes = if is_fixed { fixes } else { 0 };
                done[index] = Some(result);
            };
            let has_fixes = context.fixes_file(file.path)
                && !state.is_done
                && result.messages.iter().any(|it| it.fix.is_some());
            let (true, Some(text)) = (has_fixes, &text) else {
                let text = state.current.take().or(text);
                finish(result, text, (state.is_fixed, state.fixes));
                continue;
            };
            state.passes += 1;
            if file.config.language.is_oxlint {
                crate::lint::order_fixes_as_oxlint(&mut result.messages);
            }
            let was_rejected = result.messages.iter().any(|it| it.is_fatal);
            let fixed = apply_fixes(text, std::mem::take(&mut result.messages), &|message| {
                context.should_fix(message)
            });
            result.messages = fixed.remaining;
            if file.config.language.is_oxlint {
                // They're sorted by location now, so put them back in reported order.
                bun_lint::utils::sort::sort_by_key(&mut result.messages, |it| it.reported);
            }
            if !fixed.is_fixed {
                let text = state.current.take().or(Some(fixed.output));
                finish(result, text, (state.is_fixed, state.fixes));
                continue;
            }
            // oxlint only runs one fix pass.
            if file.config.language.is_oxlint {
                // If oxc already rejected the file, tsgolint's fixes are kept anyway.
                if !was_rejected
                    && !context.parses(file.path, &fixed.output, file.config)
                    && context.parses(file.path, text, file.config)
                {
                    context.note_broken_fixes(file.path, fixed.applied);
                    *state = Fixing {
                        current: file.text.clone(),
                        is_done: true,
                        ..Fixing::default()
                    };
                    next.push(index);
                    continue;
                }
                finish(result, Some(text.clone()), (true, fixed.count));
                if let Some(done) = &mut done[index] {
                    done.fixed_text = Some(fixed.output);
                }
                continue;
            }
            state.last_pass = Some((fixed.applied, state.is_fixed, state.fixes));
            state.is_fixed = true;
            state.fixes += fixed.count;
            let two_passes_ago = state.previous.replace(text.clone());
            state.tolerated_before = result.tolerated_errors;
            let is_circular = state.passes > 1 && two_passes_ago.as_ref() == Some(&fixed.output);
            if is_circular {
                on_circular_fixes(file.path);
            }
            state.current = Some(fixed.output);
            state.is_done = is_circular || state.passes >= MAX_AUTOFIX_PASSES;
            next.push(index);
        }
        pending = next;
    }
    done
}
