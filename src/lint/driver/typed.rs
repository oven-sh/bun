//! Lints the files that have rules which need types.
//!
//! Each is type checked with the `tsconfig.json` that an editor uses for it, and as an editor does
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
use bun_lint::context::Severity;
use bun_lint::linter::{
    Details, LintMessage, LintResult, MAX_AUTOFIX_PASSES, ResolvedConfig, RuleId, apply_fixes,
    grows_too_much, is_parse_error, max_fixed_len,
};
use bun_sema::program::FileId;
use bun_sema::resolve::{inside, to_file_name_lower_case};
use bun_sema::util::FxHashMap;
use bun_sema_driver::host::{AlreadyRead, Provided, from_native, to_native};
use bun_sema_driver::{Category, Diagnostic, Libs, Refused};
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
) -> Vec<Option<Linted>> {
    let (like_oxlint, others): (Vec<usize>, Vec<usize>) = (0..indices.len())
        // `-p` is the project of all files.
        .partition(|&at| {
            files[indices[at]].config.language.is_oxlint && context.options.project.is_none()
        });
    if like_oxlint.is_empty() {
        return check_and_lint_in(
            context,
            environment,
            files,
            indices,
            already_read,
            Project::Nearest,
        )
        .0;
    }
    let mut linted: Vec<Option<Linted>> = indices.iter().map(|_| None).collect();
    let mut check = |positions: &[usize], already_read: AlreadyRead, project: Project<'_>| {
        let some: Vec<usize> = positions.iter().map(|&at| indices[at]).collect();
        let (of_some, is_refused) =
            check_and_lint_in(context, environment, files, &some, already_read, project);
        let mut left = Vec::new();
        for ((&at, of_one), is_refused) in positions.iter().zip(of_some).zip(is_refused) {
            if of_one.is_none() && !is_refused {
                left.push(at);
            }
            linted[at] = of_one;
        }
        left
    };
    if !others.is_empty() {
        check(&others, already_read.clone(), Project::Nearest);
    }
    let left = check(&like_oxlint, already_read.clone(), Project::Including);
    if !left.is_empty() {
        let config = inside(
            &from_native(&environment.cwd),
            b"tsconfig.of-no-project.json",
        );
        let mut already_read = already_read;
        already_read.insert(config.clone(), OPTIONS_OF_NO_PROJECT.to_vec());
        check(&left, already_read, Project::This(&config));
    }
    linted
}

/// `CreateInferredProjectProgram` of tsgolint: one program for all files that no project includes, JavaScript too.
const OPTIONS_OF_NO_PROJECT: &[u8] = br#"{"compilerOptions":{"allowJs":true,"module":"esnext","moduleResolution":"bundler","target":"es2022","jsx":"react-jsx","allowImportingTsExtensions":true,"strictNullChecks":true,"strictFunctionTypes":true,"esModuleInterop":true,"resolveJsonModule":true,"noEmit":true},"files":[]}"#;

/// In which project a file is checked.
#[derive(Clone, Copy)]
enum Project<'a> {
    /// As an editor chooses it, or `-p`. A file that no project includes is in that of the nearest configuration file.
    Nearest,
    /// As tsgolint chooses it: see `PlanOptions::only_in_a_project_that_includes`.
    Including,
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
            let exact = self.exact.iter();
            exact
                .map(|(path, &at)| (to_file_name_lower_case(path), at))
                .collect()
        });
        folded.get(&to_file_name_lower_case(name)).copied()
    }
}

fn check_and_lint_in(
    context: &Context,
    environment: &Environment,
    files: &[Typed],
    indices: &[usize],
    already_read: AlreadyRead,
    project: Project<'_>,
) -> (Vec<Option<Linted>>, Vec<bool>) {
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
        Libs::Bundled(libs) => {
            if let Some(text) = (libs.read)(crate::paths::basename(path)) {
                then(&text);
            }
        }
        Libs::Directory(_) => {
            if let Ok(text) = crate::fs::read(to_native(path)) {
                then(&text);
            }
        }
    };
    let after_file = |checker: &mut bun_sema::check::Checker<'_, '_>, file: FileId| {
        let program = checker.p.files;
        let name = program.module(file).file_name();
        let Some(at) = by_path.get(name, program.is_case_sensitive) else {
            return;
        };
        let (path, config) = (files[indices[at]].path, files[indices[at]].config);
        let started = context.timing.now();
        let linted = bun_lint::types::with_file_and_modules(
            checker,
            file,
            Some(path),
            &config.language,
            Some(&read_library),
            Some(context.modules),
            |file| {
                let mut result = context.linter.lint(file, config, &options);
                if file.is_too_large_for_flow_analysis() {
                    result.messages.insert(0, too_large_for_flow_analysis());
                }
                if config.language.is_oxlint {
                    crate::lint::unused_directives_as_oxlint(&mut result, false);
                }
                context.promote_suggestions(&mut result);
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
        if let Some(linted) = linted {
            results.lock()[at] = Some(linted);
        }
    };
    let command_line = bun_sema_driver::parse_command_line(&[b"--skipLibCheck"], &environment.cwd);
    let paths: Vec<Vec<u8>> = indices
        .iter()
        .map(|&index| files[index].path.to_vec())
        .collect();
    let request = bun_sema_driver::Request {
        cwd: &environment.cwd,
        project: match project {
            Project::This(config) => Some(config),
            Project::Nearest | Project::Including => context.options.project.as_deref(),
        },
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
        digests: false,
        task_clock: None,
        plan_options: bun_sema_driver::PlanOptions {
            after_file_is_for_checked_files: true,
            // As in an editor, which is what `projectService` of typescript-eslint is.
            checks_only_named: true,
            reads_sources_of_references: true,
            current_directory_is_of_the_project: true,
            reports_nothing_about_files: !context.checks_types,
            only_in_a_project_that_includes: matches!(project, Project::Including),
            refuses_broken_configurations: matches!(project, Project::Including),
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
    let (is_case_sensitive, unreadable, diagnostics, incomplete, refused) =
        bun_sema_driver::check_provided_then(&request, provided, |report| {
            (
                report.is_case_sensitive,
                report.unreadable,
                report.diagnostics,
                report.incomplete,
                report.refused,
            )
        });
    // They are of a project, so they are not of the program of those that no project includes. They are linted without types.
    let mut is_refused = vec![false; indices.len()];
    for refused in &refused {
        for path in &refused.files {
            if let Some(at) = by_path.get(path, is_case_sensitive) {
                is_refused[at] = true;
            }
        }
        note_invalid_tsconfig(context, refused);
    }
    // Of code that is nested too deeply for the parser the linter says so itself.
    let out_of_stack = incomplete.into_iter().filter(|it| !it.is_nested_too_deeply);
    (context.out_of_stack.lock()).extend(out_of_stack.map(|it| it.path));
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
    (results, is_refused)
}

/// What oxlint makes of each error for which tsgolint makes no program (`CreateProgram`): "Invalid tsconfig", with TypeScript's
/// text as the help, at TypeScript's place in the file that TypeScript names, or else in the configuration file without a place.
fn note_invalid_tsconfig(context: &Context, refused: &Refused) {
    let mut noted = context.invalid_tsconfigs.lock();
    for diagnostic in &refused.diagnostics {
        let has_place = !diagnostic.path.is_empty();
        let path = to_native(match has_place {
            true => &diagnostic.path,
            false => &refused.config_path,
        });
        let mut help = String::from_utf8_lossy(&diagnostic.text).into_owned();
        // `enhanceHelpDiagnosticMessage`
        if strings::contains(
            &diagnostic.text,
            b"Please remove it from your configuration.",
        ) {
            help.push_str(
                "\nSee https://github.com/oxc-project/tsgolint/issues/351 for more information.",
            );
        }
        let message = LintMessage {
            rule_id: Some(RuleId::Unknown(b"typescript/tsconfig-error"[..].into())),
            severity: Severity::Error,
            message: b"Invalid tsconfig".to_vec(),
            line: diagnostic.line,
            column: diagnostic.column,
            end: has_place.then_some((diagnostic.end_line, diagnostic.end_column)),
            details: Some(Box::new(Details {
                help: help.into(),
                ..Details::default()
            })),
            ..LintMessage::default()
        };
        let at = match noted.iter().position(|it| it.path == path) {
            Some(at) => at,
            None => {
                noted.push(FileResult {
                    messages: Vec::new(),
                    text: crate::fs::read(path).ok(),
                    ..FileResult::ignored(path.to_vec(), b"")
                });
                noted.len() - 1
            }
        };
        let result = &mut noted[at];
        // Each pass of `--fix` finds it again.
        let help_of = |it: &LintMessage| it.details.as_ref().map(|it| it.help.clone());
        let is_noted = (result.messages.iter()).any(|it| {
            (it.line, it.column) == (message.line, message.column)
                && help_of(it) == help_of(&message)
        });
        if !is_noted {
            result.messages.push(message);
            result.counts = Counts::of(&result.messages);
        }
    }
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

/// What is said about a file for which [`File::is_too_large_for_flow_analysis`](bun_lint::ast::File::is_too_large_for_flow_analysis)
/// holds. typescript-eslint says nothing.
fn too_large_for_flow_analysis() -> LintMessage {
    LintMessage {
        severity: Severity::Warn,
        message: b"This file is too large for control flow analysis. What rules that need types say about it may be wrong or incomplete."
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
    /// Nothing more is fixed: only the messages about `current` are missing.
    is_over: bool,
    /// How long the text was before the first pass.
    original_len: usize,
    /// The fixes are given up, and `current` is what it was at first: see [`max_fixed_len`].
    has_grown_too_much: bool,
    /// The rules whose fixes the last pass has applied, and whether the text had changed before it.
    last_pass: Option<(Vec<RuleId>, bool)>,
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
    while !pending.is_empty() {
        let changed = states
            .iter()
            .zip(files)
            .filter_map(|(state, file)| Some((from_native(file.path), state.current.clone()?)));
        let linted = check_and_lint(context, environment, files, &pending, changed.collect());
        let mut next = Vec::new();
        for (index, linted) in pending.iter().copied().zip(linted) {
            let (file, state) = (&files[index], &mut states[index]);
            let (mut result, text) = match (linted, &state.current) {
                (Some(linted), _) => linted,
                // It was in a program before it was fixed.
                (None, Some(current)) => (
                    context.verify(file.path, current, file.config),
                    Some(current.clone()),
                ),
                (None, None) => continue,
            };
            if state.has_grown_too_much {
                result
                    .messages
                    .insert(0, grows_too_much(state.original_len));
            }
            // The fixes of the last pass are taken back.
            if matches!(&result.messages[..], [only] if is_parse_error(only))
                && let (Some(before), Some((rules, was_fixed))) =
                    (state.previous.take(), state.last_pass.take())
            {
                context.note_broken_fixes(file.path, rules);
                *state = Fixing {
                    current: Some(before),
                    is_fixed: was_fixed,
                    is_over: true,
                    ..Fixing::default()
                };
                next.push(index);
                continue;
            }
            let mut finish = |result: LintResult, text: Option<Vec<u8>>, is_fixed: bool| {
                let mut result = context.result(
                    crate::paths::to_native(file.path.to_vec()),
                    result,
                    text.unwrap_or_default(),
                    is_fixed,
                    file.config,
                );
                result.had_types = true;
                done[index] = Some(result);
            };
            let has_fixes = context.fixes()
                && !state.is_over
                && result.messages.iter().any(|it| it.fix.is_some());
            let (true, Some(text)) = (has_fixes, &text) else {
                let text = state.current.take().or(text);
                finish(result, text, state.is_fixed);
                continue;
            };
            state.passes += 1;
            if state.passes == 1 {
                state.original_len = text.len();
            }
            if file.config.language.is_oxlint {
                crate::lint::order_fixes_as_oxlint(&mut result.messages);
            }
            let fixed = apply_fixes(text, std::mem::take(&mut result.messages), &|message| {
                context.should_fix(message)
            });
            result.messages = fixed.remaining;
            if !fixed.is_fixed {
                let text = state.current.take().or(Some(fixed.output));
                finish(result, text, state.is_fixed);
                continue;
            }
            if fixed.output.len() > max_fixed_len(state.original_len) {
                *state = Fixing {
                    current: file.text.clone(),
                    is_over: true,
                    original_len: state.original_len,
                    has_grown_too_much: true,
                    ..Fixing::default()
                };
                next.push(index);
                continue;
            }
            // oxlint fixes once.
            if file.config.language.is_oxlint {
                if !context.parses(file.path, &fixed.output, file.config) {
                    context.note_broken_fixes(file.path, fixed.applied);
                    *state = Fixing {
                        current: file.text.clone(),
                        is_over: true,
                        ..Fixing::default()
                    };
                    next.push(index);
                    continue;
                }
                finish(result, Some(text.clone()), true);
                if let Some(done) = &mut done[index] {
                    done.fixed_text = Some(fixed.output);
                }
                continue;
            }
            state.last_pass = Some((fixed.applied, state.is_fixed));
            state.is_fixed = true;
            let before_the_last = state.previous.replace(text.clone());
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
