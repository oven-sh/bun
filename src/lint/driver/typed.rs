//! Lints the files that have rules which need types.
//!
//! Each is type checked with the `tsconfig.json` that an editor uses for it, and as an editor does
//! it: what it imports is only looked at as far as its types are asked for, and a project that is
//! referenced is read from its sources. A file is linted right after it is checked, by the thread
//! that checked it, while its types are there. Type errors are not reported: that is what
//! `bun check` is for.
//!
//! # Fixes
//!
//! ESLint lints a file again after it has fixed it, up to ten times. So it is here, for all files
//! at once: the files that have changed are checked again, with their new text in place of what is
//! on the disk, until none changes. The files that import them are not linted again.

use crate::lint::Context;
use crate::results::FileResult;
use crate::run::Environment;
use bun_lint::linter::{LintResult, MAX_AUTOFIX_PASSES, ResolvedConfig, apply_fixes};
use bun_sema::program::FileId;
use bun_sema::util::FxHashMap;
use bun_sema_driver::Libs;
use bun_sema_driver::host::{AlreadyRead, Provided, from_native, to_native};
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
    let by_path: FxHashMap<Vec<u8>, usize> = indices.iter().enumerate().map(|(at, &index)| (from_native(files[index].path), at)).collect();
    let mut results: Guarded<Vec<Option<Linted>>> = Guarded::new(indices.iter().map(|_| None).collect());
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
        let linted = bun_lint::types::with_file_and_modules(checker, file, &config.language, Some(&read_library), Some(context.modules), |file| {
            let mut result = context.linter.lint(file, config, &options);
            context.promote_suggestions(&mut result);
            let is_reported = !result.messages.is_empty() || !result.suppressed.is_empty();
            let text = (is_reported && (context.keeps_text || context.fixes())).then(|| file.text().to_vec());
            (result, text)
        });
        context.timing.add(&context.timing.rules, started);
        // A task of the checker can run again: the last time counts.
        if let Some(linted) = linted {
            results.lock()[at] = Some(linted);
        }
    };
    let command_line = bun_sema_driver::parse_command_line(&[b"--skipLibCheck"], &environment.cwd);
    let paths: Vec<Vec<u8>> = indices.iter().map(|&index| files[index].path.to_vec()).collect();
    let request = bun_sema_driver::Request {
        cwd: &environment.cwd,
        project: context.options.project.as_deref(),
        build: false,
        errors: &[],
        paths: &paths,
        are_entry_points: false,
        script_kinds: &[],
        script_kinds_by_extension: &[],
        conditions: &[],
        compiler_options: &command_line.compiler_options,
        threads: crate::run::threads_to_lint_on(context.options, context.js_plugins),
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
    bun_sema_driver::check_provided_then(&request, provided, |_| ());
    std::mem::take(results.get_mut())
}

/// The checker has the text of a file without its byte order mark. Puts it back, so that it is in
/// what is printed and written. `current`: the text that was checked, if it is not what is on the
/// disk.
fn with_byte_order_mark((mut result, text): Linted, current: Option<&[u8]>, path: &[u8]) -> Linted {
    const MARK: &[u8] = b"\xEF\xBB\xBF";
    let Some(text) = text else {
        return (result, None);
    };
    if !current.map_or_else(|| crate::fs::starts_with(path, MARK), |current| current.starts_with(MARK)) {
        return (result, Some(text));
    }
    let fixes = result.messages.iter_mut().chain(&mut result.suppressed).flat_map(|message| {
        let of_suggestions = message.suggestions.iter_mut().map(|it| &mut it.fix);
        message.fix.iter_mut().chain(of_suggestions)
    });
    for fix in fixes {
        fix.span.start += MARK.len() as u32;
        fix.span.end += MARK.len() as u32;
    }
    (result, Some([MARK, &text].concat()))
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
        let changed = states.iter().zip(files).filter_map(|(state, file)| Some((from_native(file.path), state.current.clone()?)));
        let linted = check_and_lint(context, environment, files, &pending, changed.collect());
        let mut next = Vec::new();
        for (index, linted) in pending.iter().copied().zip(linted) {
            let (file, state) = (&files[index], &mut states[index]);
            let (mut result, text) = match (linted, &state.current) {
                (Some(linted), current) => with_byte_order_mark(linted, current.as_deref(), file.path),
                // It was in a program before it was fixed.
                (None, Some(current)) => (context.verify(file.path, current, file.config), Some(current.clone())),
                (None, None) => continue,
            };
            let mut finish = |result: LintResult, text: Option<Vec<u8>>, is_fixed: bool| {
                let mut result = context.result(crate::paths::to_native(file.path.to_vec()), result, text.unwrap_or_default(), is_fixed, file.config);
                result.had_types = true;
                done[index] = Some(result);
            };
            let has_fixes = context.fixes() && !state.is_over && result.messages.iter().any(|it| it.fix.is_some());
            let (true, Some(text)) = (has_fixes, &text) else {
                let text = state.current.take().or(text);
                finish(result, text, state.is_fixed);
                continue;
            };
            state.passes += 1;
            let fixed = apply_fixes(text, std::mem::take(&mut result.messages), &|message| context.should_fix(message));
            result.messages = fixed.remaining;
            if !fixed.is_fixed {
                let text = state.current.take().or_else(|| Some(fixed.output));
                finish(result, text, state.is_fixed);
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
