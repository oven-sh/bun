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
use crate::results::FileResult;
use crate::run::Environment;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::linter::{
    LintMessage, LintResult, MAX_AUTOFIX_PASSES, ResolvedConfig, RuleId, apply_fixes,
    grows_too_much, max_fixed_len,
};
use bun_sema::program::FileId;
use bun_sema::util::FxHashMap;
use bun_sema_driver::host::{AlreadyRead, Provided, from_native, to_native};
use bun_sema_driver::{Category, Diagnostic, Libs};
use bun_threading::Guarded;
use std::sync::Arc;

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
        );
    }
    let mut linted: Vec<Option<Linted>> = indices.iter().map(|_| None).collect();
    let mut check = |positions: &[usize], already_read: AlreadyRead, project: Project<'_>| {
        let some: Vec<usize> = positions.iter().map(|&at| indices[at]).collect();
        let of_some = check_and_lint_in(context, environment, files, &some, already_read, project);
        let mut left = Vec::new();
        for (&at, of_one) in positions.iter().zip(of_some) {
            if of_one.is_none() {
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
        let mut config = from_native(&environment.cwd);
        config.extend_from_slice(b"/tsconfig.of-no-project.json");
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

fn check_and_lint_in(
    context: &Context,
    environment: &Environment,
    files: &[Typed],
    indices: &[usize],
    already_read: AlreadyRead,
    project: Project<'_>,
) -> Vec<Option<Linted>> {
    let by_path: FxHashMap<Vec<u8>, usize> = indices
        .iter()
        .enumerate()
        .map(|(at, &index)| (from_native(files[index].path), at))
        .collect();
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
        let Some(&at) = by_path.get(checker.p.files.module(file).file_name()) else {
            return;
        };
        let config = files[indices[at]].config;
        let started = context.timing.now();
        let linted = bun_lint::types::with_file_and_modules(
            checker,
            file,
            &config.language,
            Some(&read_library),
            Some(context.modules),
            |file| {
                let mut result = context.linter.lint(file, config, &options);
                if file.is_too_large_for_flow_analysis() {
                    result.messages.insert(0, too_large_for_flow_analysis());
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
        ..Default::default()
    };
    let diagnostics =
        bun_sema_driver::check_provided_then(&request, provided, |report| report.diagnostics);
    let mut results = std::mem::take(results.get_mut());
    if context.checks_types {
        for diagnostic in diagnostics
            .iter()
            .filter(|it| it.category == Category::Error)
        {
            let at = by_path.get(&diagnostic.path).copied();
            if let Some((result, _)) = at.and_then(|at| results.get_mut(at)?.as_mut()) {
                result.messages.push(type_error(diagnostic));
            }
        }
        for (result, _) in results.iter_mut().flatten() {
            result.messages.sort_by_key(|it| (it.line, it.column));
        }
    }
    results
}

/// What oxlint makes of an error of the type checker: `typescript(TS2322)`, with the first line of the text. No comment disables it.
fn type_error(diagnostic: &Diagnostic) -> LintMessage {
    let text = &diagnostic.text[..];
    let end = strings::index_of_char_usize(text, b'\n').unwrap_or(text.len());
    LintMessage {
        rule_id: Some(RuleId::Unknown(
            format!("typescript/TS{}", diagnostic.code)
                .into_bytes()
                .into(),
        )),
        message: text[..end].to_vec(),
        line: diagnostic.line,
        column: diagnostic.column,
        end: Some((diagnostic.end_line, diagnostic.end_column)),
        ..LintMessage::default()
    }
}

/// The checker has the text of a file without its byte order mark. Puts it back, so that it is in
/// what is printed and written. `current`: the text that was checked, if it is not what is on the
/// disk.
fn with_byte_order_mark((mut result, text): Linted, current: Option<&[u8]>, path: &[u8]) -> Linted {
    const MARK: &[u8] = b"\xEF\xBB\xBF";
    let Some(text) = text else {
        return (result, None);
    };
    if !current.map_or_else(
        || crate::fs::starts_with(path, MARK),
        |current| current.starts_with(MARK),
    ) {
        return (result, Some(text));
    }
    let fixes = result
        .messages
        .iter_mut()
        .chain(&mut result.suppressed)
        .flat_map(|message| {
            let of_suggestions = message.suggestions.iter_mut().map(|it| &mut it.fix);
            message.fix.iter_mut().chain(of_suggestions)
        });
    for fix in fixes {
        fix.span.start += MARK.len() as u32;
        fix.span.end += MARK.len() as u32;
    }
    (result, Some([MARK, &text].concat()))
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
                (Some(linted), current) => {
                    with_byte_order_mark(linted, current.as_deref(), file.path)
                }
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
