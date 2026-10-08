//! Lints one file that needs no types: reads it, parses it, binds it, runs the rules, and fixes.
//! Everything but the messages is freed before the next file.

use crate::cli::{FixType, Options};
use crate::configs::Flavor;
use crate::discover::{Status, Target};
use crate::results::{Counts, FileResult};
use crate::run::{Fatal, Timing};
use crate::{fs, paths};
use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::context::Severity;
use bun_lint::js_plugin::Host;
use bun_lint::linter::{Again, LintMessage, LintOptions, LintResult, Linter, ResolvedConfig, RuleId};
use bun_lint_graph::Graph;
use bun_lint::rule::Kind;
use bun_sema::atom::Intern;
use bun_sema::bind::{BindOptions, bind_for_lint};
use bun_sema::session::Session;
use std::borrow::Cow;
use std::sync::Arc;
use std::time::Instant;

/// What is the same for all files of a run.
pub(crate) struct Context<'c, 'm> {
    pub(crate) linter: &'c Linter,
    pub(crate) options: &'c Options,
    pub(crate) cwd: &'c [u8],
    /// Whether [`FileResult::text`] is read.
    pub(crate) keeps_text: bool,
    /// Whether the fixes and the suggestions of messages are read, if only to be counted.
    pub(crate) reads_fixes: bool,
    /// Runs the rules that are written in JavaScript.
    pub(crate) js_plugins: &'c Host<'c>,
    /// Which file imports which, for the rules that are about several files.
    pub(crate) modules: &'c Graph<'m>,
    pub(crate) timing: &'c Timing,
    /// The names in all files that are linted without types. They are freed when the run ends: what
    /// they take is bounded by the distinct names and strings of the project.
    pub(crate) atoms: &'c dyn Intern,
}

fn only_errors(_: &RuleId, severity: Severity) -> bool {
    severity == Severity::Error
}

impl Context<'_, '_> {
    pub(crate) fn lint_options(&self) -> LintOptions<'_> {
        LintOptions {
            allow_inline_config: self.options.inline_config,
            // It is part of the configuration: see `Loader::override_config`.
            report_unused_disable_directives: None,
            wants_fixes: self.fixes() || self.reads_fixes,
            // Warnings have to be counted for `--max-warnings`.
            rule_filter: match self.options.quiet && self.options.max_warnings == -1 {
                true => Some(&only_errors),
                false => None,
            },
            js_plugins: Some(self.js_plugins),
            again: None,
        }
    }

    pub(crate) fn fixes(&self) -> bool {
        self.options.fix || self.options.fix_dry_run
    }

    /// oxlint's `--fix-suggestions`: a suggestion is as good as a fix.
    pub(crate) fn promote_suggestions(&self, result: &mut LintResult) {
        if !self.options.fix_suggestions {
            return;
        }
        for message in result.messages.iter_mut().filter(|it| it.fix.is_none() && !it.suggestions.is_empty()) {
            message.fix = Some(message.suggestions.swap_remove(0).fix);
            message.suggestions.clear();
        }
    }

    /// ESLint's `fix` option as `getFixerForFixTypes` makes it.
    pub(crate) fn should_fix(&self, message: &LintMessage) -> bool {
        if self.options.quiet && message.severity != Severity::Error {
            return false;
        }
        let Some(types) = &self.options.fix_type else {
            return true;
        };
        types.contains(&match &message.rule_id {
            None => FixType::Directive,
            Some(RuleId::Known(meta)) => match meta.kind {
                Kind::Problem => FixType::Problem,
                Kind::Suggestion => FixType::Suggestion,
                Kind::Layout => FixType::Layout,
            },
            Some(RuleId::Js(rule)) => match rule.kind {
                Some(Kind::Problem) => FixType::Problem,
                Some(Kind::Suggestion) => FixType::Suggestion,
                Some(Kind::Layout) => FixType::Layout,
                None => return false,
            },
            Some(RuleId::Unknown(_)) => return false,
        })
    }

    /// ESLint's `createIgnoreResult`.
    pub(crate) fn ignored(&self, path: &[u8], status: &Status) -> FileResult {
        let message: &[u8] = match status {
            Status::External => b"File ignored because outside of base path.",
            Status::Unconfigured => b"File ignored because no matching configuration was supplied.",
            _ => {
                let relative = paths::relative(self.cwd, path);
                let directories = strings::split(&relative, b"/").collect::<Vec<_>>();
                let (_, directories) = directories.split_last().unwrap_or((&&b""[..], &[]));
                match directories.contains(&&b"node_modules"[..]) {
                    true => {
                        b"File ignored by default because it is located under the node_modules directory. Use ignore pattern \"!**/node_modules/\" to disable file ignore settings or use \"--no-warn-ignored\" to suppress this warning."
                    }
                    false => {
                        b"File ignored because of a matching ignore pattern. Use \"--no-ignore\" to disable file ignore settings or use \"--no-warn-ignored\" to suppress this warning."
                    }
                }
            }
        };
        FileResult::ignored(paths::to_native(path.to_vec()), message)
    }

    /// Parses `text` as the file at `path` and lints it, without types.
    pub(crate) fn verify(&self, path: &[u8], text: &[u8], config: &ResolvedConfig) -> LintResult {
        self.verify_or_again(path, text, config, None)
    }

    /// Lints a file again that `modules` names when all files are linted.
    pub(crate) fn lint_again(&self, result: &mut FileResult) -> Result<(), Fatal> {
        let Some(config) = result.config.clone() else {
            return Ok(());
        };
        let path = paths::from_native(&result.path);
        let text = match result.text.take() {
            Some(text) => text,
            None => fs::read(&path).map_err(|error| Fatal([b"Cannot read ", &path[..], b": ", &fs::describe(&error)].concat()))?,
        };
        let previous = LintResult {
            messages: std::mem::take(&mut result.messages),
            suppressed: std::mem::take(&mut result.suppressed),
            ..LintResult::default()
        };
        let again = Again {
            previous: &previous,
            had_types: result.had_types,
        };
        let linted = self.verify_or_again(&path, &text, &config, Some(again));
        let had_types = result.had_types;
        *result = self.result(std::mem::take(&mut result.path), linted, text, result.is_fixed, &config);
        result.had_types = had_types;
        Ok(())
    }

    fn verify_or_again(&self, path: &[u8], text: &[u8], config: &ResolvedConfig, again: Option<Again>) -> LintResult {
        let started = self.timing.now();
        let session = Session::new();
        let atoms = self.atoms;
        let arena = session.arena();
        let how = config.language.parse_options(path);
        let (mut hir, _) = bun_js_parser::sema::summarize_in(
            how.dialect,
            (arena, &session),
            path,
            how.script_kind,
            text,
            atoms,
            how.experimental_decorators,
            how.every_file_is_a_module,
        );
        hir.text = Cow::Borrowed(text);
        let bind_options = BindOptions {
            emit_standard_class_fields: true,
            before_es2020: false,
            before_es2017: false,
        };
        let bound = bind_for_lint(&hir, bind_options, atoms, arena);
        let parsed = self.timing.add(&self.timing.parse, started);
        if hir.ran_out_of_stack || bound.ran_out_of_stack {
            return LintResult {
                messages: vec![too_deep()],
                ..LintResult::default()
            };
        }
        let file = File::new(path, &hir, &bound, atoms, &config.language, None);
        file.set_modules(self.modules);
        let options = LintOptions {
            again,
            ..self.lint_options()
        };
        let mut result = self.linter.lint(&file, config, &options);
        self.promote_suggestions(&mut result);
        self.timing.add(&self.timing.rules, parsed);
        result
    }

    /// ESLint's `verifyText`. `path`: what is printed. `path_to_verify`: what the file is linted as.
    pub(crate) fn verify_text(
        &self,
        path: Vec<u8>,
        path_to_verify: &[u8],
        text: Vec<u8>,
        config: &Arc<ResolvedConfig>,
        on_circular_fixes: &dyn Fn(&[u8]),
    ) -> FileResult {
        let (result, text, is_fixed) = match self.fixes() {
            false => (self.verify(path_to_verify, &text, config), text, false),
            true => {
                let report = bun_lint::linter::verify_and_fix(&text, &|message| self.should_fix(message), &mut |text| {
                    self.verify(path_to_verify, text, config)
                });
                if report.is_circular {
                    on_circular_fixes(path_to_verify);
                }
                (report.result, report.output, report.is_fixed)
            }
        };
        self.result(path, result, text, is_fixed, config)
    }

    pub(crate) fn result(
        &self,
        path: Vec<u8>,
        result: LintResult,
        text: Vec<u8>,
        is_fixed: bool,
        config: &Arc<ResolvedConfig>,
    ) -> FileResult {
        let counts = Counts::of(&result.messages);
        let is_reported = !result.messages.is_empty() || !result.suppressed.is_empty();
        FileResult {
            path,
            counts,
            has_source: !is_fixed && counts.errors + counts.warnings > 0,
            text: (is_fixed || (self.keeps_text && is_reported)).then_some(text),
            messages: result.messages,
            suppressed: result.suppressed,
            thrown: result.thrown,
            had_types: false,
            is_fixed,
            is_ignored: false,
            config: Some(Arc::clone(config)),
        }
    }

    /// ESLint's `lintFile`. `None`: there is nothing to say about the file.
    pub(crate) fn lint_file(
        &self,
        target: &Target,
        on_circular_fixes: &dyn Fn(&[u8]),
    ) -> Result<Option<FileResult>, Fatal> {
        let Status::Matched(config) = &target.status else {
            // oxlint says nothing about such a file.
            let warns = self.options.warn_ignored && target.loaded.flavor != Flavor::Oxlint;
            return Ok(warns.then(|| self.ignored(&target.path, &target.status)));
        };
        let started = self.timing.now();
        let text = fs::read_sized(&target.path, target.size)
            .map_err(|error| Fatal([b"Cannot read ", &target.path[..], b": ", &fs::describe(&error)].concat()))?;
        self.timing.add(&self.timing.read, started);
        Ok(Some(self.verify_text(paths::to_native(target.path.clone()), &target.path, text, config, on_circular_fixes)))
    }
}

fn too_deep() -> LintMessage {
    LintMessage {
        rule_id: None,
        severity: Severity::Error,
        message: b"Parsing error: The code is nested too deeply.".to_vec(),
        message_id: None,
        line: 1,
        column: 1,
        end: None,
        is_fatal: true,
        fix: None,
        suggestions: Vec::new(),
        suppressions: Vec::new(),
    }
}

/// How long since `started`, if time is measured.
pub(crate) fn elapsed(started: Option<Instant>) -> u64 {
    started.map_or(0, |started| started.elapsed().as_nanos() as u64)
}
