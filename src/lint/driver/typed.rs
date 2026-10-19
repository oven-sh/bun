//! Lints the files that have rules which need types.
//!
//! Each is type checked with the `tsconfig.json` that an editor uses for it, or with the first that includes it of those
//! that `parserOptions.project` names, and as an editor does
//! it: what it imports is only looked at as far as its types are asked for, and a project that is
//! referenced is read from its sources. A file is linted right after it is checked, by the thread
//! that checked it, while its types are there. Type errors are not reported, that is what
//! `bun check` is for, unless oxlint's `--type-check` asks for them.
//!
//! # Fixes
//!
//! ESLint lints a file again after it has fixed it, up to ten times. So it is here, for all files
//! at once: the files that have changed are checked again, with their new text in place of what is
//! on the disk, until none changes. The files that import them are not linted again.

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
use bun_sema_driver::{Category, Diagnostic, Libs, Refused, WithoutInclude};
use bun_threading::Guarded;
use std::sync::{Arc, OnceLock};

/// A file to lint.
pub(crate) struct Typed<'t> {
    pub(crate) path: &'t [u8],
    pub(crate) config: &'t Arc<ResolvedConfig>,
    /// Its text, if that is not what is on the disk: standard input.
    pub(crate) text: Option<Vec<u8>>,
}

/// What is reported about a file, and its text if that is needed.
type Linted = (LintResult, Option<Vec<u8>>);

/// Checks the programs of `files`, and lints those at `indices`. `None` for a file that is in no
/// program, or that cannot be linted as it is there.
fn check_and_lint(
    context: &Context,
    environment: &Environment,
    files: &[Typed],
    indices: &[usize],
    already_read: AlreadyRead,
    is_first_pass: bool,
) -> Vec<Option<Linted>> {
    // tsgolint chooses the project of each file itself: oxlint does not tell it about `--tsconfig`.
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
    // Returns the files that no project includes, and whether one of them is not linted.
    let mut check = |positions: &[usize], already_read: AlreadyRead, project: Project<'_>| {
        let some: Vec<usize> = positions.iter().map(|&at| indices[at]).collect();
        let (of_some, place) = check_and_lint_in(
            context,
            environment,
            files,
            &some,
            already_read,
            project,
            is_first_pass,
        );
        let (mut in_no_project, mut is_one_left) = (Vec::new(), false);
        for ((&at, of_one), place) in positions.iter().zip(of_some).zip(place) {
            let is_left = of_one.is_none() && place != Place::Refused;
            if is_left || place == Place::InNoProject {
                in_no_project.push(at);
            }
            is_one_left |= is_left;
            linted[at] = of_one;
        }
        (in_no_project, is_one_left)
    };
    if !others.is_empty() {
        check(&others, already_read.clone(), Project::Nearest);
    }
    let config = inside(
        &from_native(&environment.cwd),
        b"tsconfig.of-no-project.json",
    );
    let mut already_read = already_read;
    already_read.insert(config.clone(), OPTIONS_OF_NO_PROJECT.to_vec());
    let (in_no_project, is_one_left) = check(
        &like_oxlint,
        already_read.clone(),
        Project::Including(&config),
    );
    // Its project could not lint it, so it counts as in no project too. All of those are one program, which is made again.
    if is_one_left {
        check(&in_no_project, already_read, Project::This(&config));
    }
    linted
}

/// Where a file was looked at.
#[derive(Clone, Copy, PartialEq)]
enum Place {
    InAProject,
    /// In the program of those that no project includes.
    InNoProject,
    /// Its project is refused. It is linted without types.
    Refused,
}

/// `CreateInferredProjectProgram` of tsgolint: one program for all files that no project includes, JavaScript too.
const OPTIONS_OF_NO_PROJECT: &[u8] = br#"{"compilerOptions":{"allowJs":true,"module":"esnext","moduleResolution":"bundler","target":"es2022","jsx":"react-jsx","allowImportingTsExtensions":true,"strictNullChecks":true,"strictFunctionTypes":true,"esModuleInterop":true,"resolveJsonModule":true,"noEmit":true},"files":[]}"#;

/// In which project a file is checked.
#[derive(Clone, Copy)]
enum Project<'a> {
    /// As an editor chooses it, or `-p`. A file that no project includes is in that of the nearest configuration file.
    Nearest,
    /// As tsgolint chooses it: see `PlanOptions::only_in_a_project_that_includes`. A file that no project includes is in that of
    /// this configuration file.
    Including(&'a [u8]),
    /// That of this configuration file.
    This(&'a [u8]),
}

/// Where the files to lint are in a list, by `tspath.Path`: where the file system folds case, a program need not spell a file
/// as the argument or the working directory that led to it does.
struct ByPath {
    /// By the path in the checker's format.
    exact: FxHashMap<Vec<u8>, usize>,
    /// The same in lower case. Made when a name is asked for that `exact` does not have.
    folded: OnceLock<FxHashMap<Vec<u8>, usize>>,
}

impl ByPath {
    /// `name`: of a file of a program.
    fn get(&self, name: &[u8], is_case_sensitive: bool) -> Option<usize> {
        if let Some(&at) = self.exact.get(name) {
            return Some(at);
        }
        if is_case_sensitive {
            return None;
        }
        let folded = self.folded.get_or_init(|| {
            // Of two that differ in case alone, the first counts.
            let exact =
                bun_lint::utils::sort::in_order_of(&self.exact, |it| std::cmp::Reverse(*it.1));
            (exact.into_iter())
                .map(|(path, &at)| (to_file_name_lower_case(path), at))
                .collect()
        });
        folded.get(&to_file_name_lower_case(name)).copied()
    }
}

/// `parserOptions.project` where it names files.
struct Listed<'t> {
    by_path: &'t ByPath,
    /// For each file in `by_path`, where its list is in `lists`.
    of_file: Vec<usize>,
    lists: Vec<Vec<Vec<u8>>>,
}

impl bun_sema_driver::ListedProjects for Listed<'_> {
    fn of(&self, path: &[u8], is_case_sensitive: bool) -> &[Vec<u8>] {
        let at = self.by_path.get(path, is_case_sensitive);
        at.map_or(&[], |at| &self.lists[self.of_file[at]])
    }
}

impl<'t> Listed<'t> {
    fn new(by_path: &'t ByPath, files: &[Typed], indices: &[usize], cwd: &[u8]) -> Listed<'t> {
        let cwd = crate::paths::from_native(cwd);
        // The files of one configuration have one list, and so have the configurations that say the same.
        let mut by_config: FxHashMap<*const ResolvedConfig, usize> = FxHashMap::default();
        let mut by_text: FxHashMap<Vec<u8>, usize> = FxHashMap::default();
        let mut lists = Vec::new();
        let of_file = indices.iter().map(|&index| {
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
            of_file: of_file.collect(),
            lists,
        }
    }
}

/// `resolveProjectList` of typescript-estree 8.71: the names that are no patterns first, in their order, wherever they stand,
/// then what each pattern finds. In the checker's format. Empty: `project` names nothing, or `projectService` overrides it.
fn resolve_project_list(options: &Json, cwd: &[u8]) -> Vec<Vec<u8>> {
    let written = strings_of(options.get(b"project"));
    if written.is_empty() || options.get(b"projectService").is_some_and(Json::is_truthy) {
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
        (written.iter().copied()).partition(|it| bun_glob::scan::is_glob(it));
    let names = names.iter();
    let mut list: Vec<Vec<u8>> = names
        .map(|it| crate::paths::resolve(&root, &crate::paths::portable(&root, it)))
        .collect();
    for pattern in patterns {
        list.extend(files_matching(&root, pattern, &ignored));
    }
    let mut seen = bun_sema::util::FxHashSet::default();
    list.retain(|it| seen.insert(it.clone()));
    let in_the_format_of_the_checker = |it: Vec<u8>| from_native(&crate::paths::to_native(it));
    list.into_iter().map(in_the_format_of_the_checker).collect()
}

/// What tinyglobby finds for `pattern` below `root`, sorted: it has them in the order in which it reads the directories.
/// A link to a directory is not followed.
fn files_matching(mut root: &[u8], pattern: &[u8], ignored: &[&[u8]]) -> Vec<Vec<u8>> {
    let mut pattern = pattern.strip_prefix(b"./").unwrap_or(pattern);
    // It starts as far up as the pattern goes.
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
    // From `root`. A loop: directories can be nested to any depth.
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

/// The globals of a program that is loaded anyway.
struct OfProgram {
    /// `None`: see `Files::global_names`.
    names: Option<Vec<InferredGlobal>>,
    checks_javascript: bool,
    /// The files that are in it only because they are linted, each by the name that the program has for it: the project does
    /// not include them, so they are not written for its libraries.
    added: FxHashSet<Vec<u8>>,
}

impl OfProgram {
    fn new(program: &Files<'_>) -> OfProgram {
        let inferred = |it: bun_sema::program::GlobalName| InferredGlobal {
            name: it.name,
            is_value: it.is_value,
            is_type: it.is_type,
            is_writable: it.is_writable,
        };
        let names = program.global_names();
        let options = program.options;
        let added = options.own_roots.and_then(|own| options.files.get(own..));
        OfProgram {
            names: names.map(|it| it.into_iter().map(inferred).collect()),
            checks_javascript: options.check_js == Some(true),
            added: added.unwrap_or_default().iter().cloned().collect(),
        }
    }
}

/// What [`OfProgram`] has for one file.
struct OfFile<'p>(Option<ProgramGlobals<'p>>);

impl InferredGlobals for OfFile<'_> {
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
) -> (Vec<Option<Linted>>, Vec<Place>) {
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
    // The text of a file of TypeScript's library, which the checker does not keep.
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
    // By configuration file.
    let of_programs: Guarded<Vec<(Vec<u8>, Arc<OfProgram>)>> = Guarded::new(Vec::new());
    let mut places = Guarded::new(vec![Place::InAProject; indices.len()]);
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
                places.lock()[at] = Place::InNoProject;
                false
            }
            Project::Including(_) | Project::Nearest => !project_of_file.is_empty(),
        };
        let is_javascript = bun_sema::resolve::is_javascript(name);
        let infers = config.language.infers_globals.is_for(is_javascript);
        let of_program = (infers && is_in_a_project).then(|| {
            let mut known = of_programs.lock();
            if let Some(found) = known.iter().find(|it| it.0 == *project_of_file) {
                return Arc::clone(&found.1);
            }
            let made = Arc::new(OfProgram::new(program));
            known.push((project_of_file.clone(), Arc::clone(&made)));
            made
        });
        let of_program = of_program.as_ref().filter(|it| !it.added.contains(name));
        let of_file = OfFile(of_program.and_then(|it| {
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
            Some(&of_file),
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
                // What the type checker reports is known when all files are checked.
                let is_reported = !result.messages.is_empty()
                    || !result.suppressed.is_empty()
                    || context.checks_types;
                let text = (is_reported && (context.keeps_text || context.fixes()))
                    .then(|| file.text().to_vec());
                (result, text)
            },
        );
        context.timing.add(&context.timing.rules, started);
        // A task of the checker can run again: the last time counts.
        match linted {
            Some(linted) => results.lock()[at] = Some(linted),
            // It is linted without types. Of a tree that is too deep for the parser the linter says so itself.
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
        only: None,
        order: 1,
        plan_options: bun_sema_driver::PlanOptions {
            after_file_is_for_checked_files: true,
            // As in an editor, which is what `projectService` of typescript-eslint is.
            checks_only_named: true,
            reads_sources_of_references: true,
            current_directory_is_of_the_project: true,
            reports_nothing_about_files: !context.checks_types,
            only_in_a_project_that_includes: matches!(project, Project::Including(_)),
            project_is_for_the_rest: matches!(project, Project::Including(_)),
            memory: environment.memory,
            shares_every_file: true,
            refuses_broken_configurations: matches!(project, Project::Including(_)),
            // typescript-eslint checks with the compiler of the project. tsgolint has its own files.
            prefers_the_library_of_the_project: matches!(project, Project::Nearest),
            ..Default::default()
        },
        retains_everything: false,
        // A syntax error in one file does not keep the others from being linted.
        stops_like_tsc: false,
        uses_typescript_wording: false,
        loaded: None,
        checked: None,
        after_file: Some(&after_file),
        declaration_file_emitted: None,
    };
    let provided = Provided {
        already_read,
        keeps_byte_order_marks: true,
        ..Default::default()
    };
    let (is_case_sensitive, unreadable, diagnostics, incomplete, refused, without_include) =
        bun_sema_driver::check_provided_then(&request, provided, |report| {
            (
                report.is_case_sensitive,
                report.unreadable,
                report.diagnostics,
                report.incomplete,
                report.refused,
                report.without_include,
            )
        });
    // The later passes of `--fix` lint some of the same files again.
    if is_first_pass {
        let mut noted = context.without_include.lock();
        for program in without_include {
            let config_path = to_native(&program.config_path).to_vec();
            // Each kind of configuration loads it for its own files.
            match noted.iter_mut().find(|it| it.config_path == config_path) {
                Some(known) => {
                    known.asked_for += program.asked_for;
                    known.load_time += program.load_time;
                }
                None => noted.push(WithoutInclude {
                    config_path,
                    // As it is spelled by who named it.
                    example: match by_path.get(&program.example, is_case_sensitive) {
                        Some(at) => files[indices[at]].path.to_vec(),
                        None => to_native(&program.example).to_vec(),
                    },
                    ..program
                }),
            }
        }
    }
    // They are of a project, so they are not of the program of those that no project includes. They are linted without types.
    let mut places = std::mem::take(places.get_mut());
    for refused in &refused {
        for path in &refused.files {
            if let Some(at) = by_path.get(path, is_case_sensitive) {
                places[at] = Place::Refused;
            }
        }
        note_invalid_tsconfig(context, refused);
    }
    // Of code that is nested too deeply for the parser the linter says so itself.
    let out_of_stack = incomplete.into_iter().filter(|it| !it.is_nested_too_deeply);
    (context.out_of_stack.lock()).extend(out_of_stack.map(|it| to_native(&it.path).to_vec()));
    let mut results = std::mem::take(results.get_mut());
    // Each was checked, and linted, as an empty file. Who lints it without types says why it cannot be read.
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
    (results, places)
}

/// Whether nearly all of the time went into files that nobody asked about: a thousand or more, and a hundred for each
/// that was linted. A `tsconfig.json` at the top of a repository is like that for a file that its own package leaves out.
pub(crate) fn is_out_of_proportion(program: &WithoutInclude) -> bool {
    program.included >= 1000 && program.included >= 100 * program.asked_for
}

/// What oxlint makes of each error for which tsgolint makes no program (`CreateProgram`): "Invalid tsconfig", with TypeScript's
/// text as the help, at TypeScript's place in the file that TypeScript names, or else in the configuration file without a place.
fn note_invalid_tsconfig(context: &Context, refused: &Refused) {
    let mut noted = context.invalid_tsconfigs.lock();
    // Each pass of `--fix` finds it again.
    if noted.of.contains(&refused.config_path) {
        return;
    }
    noted.of.push(refused.config_path.clone());
    let noted = &mut noted.results;
    for diagnostic in &refused.diagnostics {
        let has_place = !diagnostic.path.is_empty();
        let path = to_native(match has_place {
            true => &diagnostic.path,
            false => &refused.config_path,
        });
        // `GetDiagnosticMessage`: without what is chained to it.
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
        let is_oxlint = context.of_oxlint.is_some();
        let message = LintMessage {
            rule_id: Some(RuleId::Unknown(b"typescript/tsconfig-error"[..].into())),
            severity: Severity::Error,
            message: match is_oxlint {
                true => b"Invalid tsconfig".to_vec(),
                false => [&b"Invalid tsconfig: "[..], text].concat(),
            },
            line: diagnostic.line,
            column: diagnostic.column,
            end: has_place.then_some((diagnostic.end_line, diagnostic.end_column)),
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
        // What two programs have from one base file is said once for each.
        result.messages.push(message);
        // `SortAndDeduplicateDiagnostics`: those without a place first, by their text.
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
    /// By file.
    pub(crate) results: Vec<FileResult>,
    /// The configuration files of the programs that `results` is about.
    of: Vec<Vec<u8>>,
}

/// What oxlint makes of an error of the type checker: `typescript(TS2322)`, with the first line of the text. No comment disables it.
fn type_error(diagnostic: &Diagnostic) -> LintMessage {
    let text = &diagnostic.text[..];
    let end = strings::index_of_char_usize(text, b'\n').unwrap_or(text.len());
    // TypeScript drops the byte order mark, which the text that is checked here has: it is no character of the first line.
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

/// Whether [`type_error`] made `message`.
pub(crate) fn is_type_error(message: &LintMessage) -> bool {
    message.message_id.is_none()
        && matches!(&message.rule_id, Some(RuleId::Unknown(id)) if id.starts_with(b"typescript/TS"))
}

/// What is said about a file for which [`File::is_too_large_for_flow_analysis`](bun_lint::ast::File::is_too_large_for_flow_analysis)
/// holds. typescript-eslint says nothing.
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

/// Where ESLint's `verifyAndFix` is with a file.
#[derive(Default)]
struct Fixing {
    /// `None`: what is on the disk.
    current: Option<Vec<u8>>,
    previous: Option<Vec<u8>>,
    passes: usize,
    is_fixed: bool,
    /// Number of fixes applied to get `current`.
    fixes: usize,
    /// Nothing more is fixed: only the messages about `current` are missing.
    is_over: bool,
    /// The rules whose fixes the last pass applied, then `is_fixed` and `fixes` as they were before that pass.
    last_pass: Option<(Vec<RuleId>, bool, usize)>,
    /// [`LintResult::tolerated_errors`] of `previous`.
    tolerated_before: usize,
}

/// Lints `files` with types. `None` for a file that has to be linted without.
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
            // The fixes of the last pass are taken back.
            if breaks_syntax(&result, state.tolerated_before)
                && let (Some(before), Some((rules, was_fixed, fixes))) =
                    (state.previous.take(), state.last_pass.take())
            {
                context.note_broken_fixes(file.path, rules);
                *state = Fixing {
                    current: Some(before),
                    is_fixed: was_fixed,
                    fixes,
                    is_over: true,
                    ..Fixing::default()
                };
                next.push(index);
                continue;
            }
            let mut finish = |result: LintResult, text: Option<Vec<u8>>, fixed: (bool, usize)| {
                let (is_fixed, fixes) = fixed;
                // What is not there is not written.
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
                && !state.is_over
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
            let was_refused = result.messages.iter().any(|it| it.is_fatal);
            let fixed = apply_fixes(text, std::mem::take(&mut result.messages), &|message| {
                context.should_fix(message)
            });
            result.messages = fixed.remaining;
            if file.config.language.is_oxlint {
                // They are by place now.
                bun_lint::utils::sort::sort_by_key(&mut result.messages, |it| it.reported);
            }
            if !fixed.is_fixed {
                let text = state.current.take().or(Some(fixed.output));
                finish(result, text, (state.is_fixed, state.fixes));
                continue;
            }
            // oxlint fixes once.
            if file.config.language.is_oxlint {
                // A file that oxc refuses keeps what tsgolint fixes in it.
                if !was_refused
                    && !context.parses(file.path, &fixed.output, file.config)
                    && context.parses(file.path, text, file.config)
                {
                    context.note_broken_fixes(file.path, fixed.applied);
                    *state = Fixing {
                        current: file.text.clone(),
                        is_over: true,
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
            let before_the_last = state.previous.replace(text.clone());
            state.tolerated_before = result.tolerated_errors;
            let is_circular = state.passes > 1 && before_the_last.as_ref() == Some(&fixed.output);
            if is_circular {
                on_circular_fixes(file.path);
            }
            state.current = Some(fixed.output);
            state.is_over = is_circular || state.passes >= MAX_AUTOFIX_PASSES;
            next.push(index);
        }
        pending = next;
    }
    done
}
