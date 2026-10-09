//! Lints one file that needs no types: reads it, parses it, binds it, runs the rules, and fixes.
//! Everything but the messages is freed before the next file.

use crate::cli::{FixType, Options};
use crate::configs::{Flavor, Loaded};
use crate::discover::{Status, Target};
use crate::embedded::Framework;
use crate::results::{Counts, FileResult, Linted};
use crate::run::{Fatal, Timing};
use crate::{fs, paths};
use bun_core::strings;
use bun_lint::ast::{File, VueScript};
use bun_lint::context::Severity;
use bun_lint::fix::SuggestionKind;
use bun_lint::js_plugin::Host;
use bun_lint::linter::{
    Again, LintMessage, LintOptions, LintResult, Linter, ResolvedConfig, RuleId, Suggestion,
};
use bun_lint::rule::Kind;
use bun_lint_graph::Graph;
use bun_sema::atom::Intern;
use bun_sema::bind::{BindOptions, Recycled, bind_for_lint_in};
use bun_sema::resolve::ScriptKind;
use bun_sema::session::Session;
use std::sync::Arc;
use std::time::Instant;

/// What is the same for all files of a run.
pub(crate) struct Context<'c, 'm> {
    pub(crate) linter: &'c Linter,
    pub(crate) options: &'c Options,
    pub(crate) cwd: &'c [u8],
    /// The configuration of the working directory, if it is one of oxlint.
    pub(crate) of_oxlint: Option<&'c Loaded>,
    /// `--type-check`: what the type checker reports is reported too.
    pub(crate) checks_types: bool,
    /// Whether [`FileResult::text`] is read.
    pub(crate) keeps_text: bool,
    /// Whether the fixes and the suggestions of messages are read, if only to be counted.
    pub(crate) reads_fixes: bool,
    /// Whether it is read which comments suppress a message.
    pub(crate) reads_suppressions: bool,
    /// Runs the rules that are written in JavaScript.
    pub(crate) js_plugins: &'c Host<'c>,
    /// Which file imports which, for the rules that are about several files.
    pub(crate) modules: &'c Graph<'m>,
    pub(crate) timing: &'c Timing,
    /// The names in all files that are linted without types. They are freed when the run ends: what
    /// they take is bounded by the distinct names and strings of the project.
    pub(crate) atoms: &'c dyn Intern,
    /// Where the lists of a file are while it is linted. They are freed one by one when the file is
    /// done with: a heap for each file would start with fresh pages every time.
    pub(crate) memory: &'c Session,
}

/// ESLint's `ruleFilter`.
pub(crate) type RuleFilter<'f> = dyn Fn(&RuleId, Severity) -> bool + Sync + 'f;

/// How a text is linted, if not like a file.
#[derive(Copy, Clone, Default)]
struct How<'h> {
    /// See [`LintOptions::again`].
    again: Option<Again<'h>>,
    /// ESLint's `disableFixes`.
    without_fixes: bool,
    /// See [`LintOptions::physical_path_len`].
    physical_path_len: Option<usize>,
    /// It is a script in a file: its language, and which rules run.
    script: Option<(ScriptKind, &'h RuleFilter<'h>)>,
    /// Which rules run, if not all.
    only: Option<&'h RuleFilter<'h>>,
    vue_script: VueScript,
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
            wants_suppressions: self.reads_suppressions,
            // Warnings have to be counted for `--max-warnings`.
            rule_filter: match self.options.quiet
                && self.options.max_warnings == -1
                && !self.fixes_warnings()
            {
                true => Some(&only_errors),
                false => None,
            },
            js_plugins: Some(self.js_plugins),
            respects_eslint_comments: self.of_oxlint.is_none_or(|it| it.respects_eslint_comments),
            ..LintOptions::default()
        }
    }

    pub(crate) fn fixes(&self) -> bool {
        self.options.fix || self.options.fix_dry_run
    }

    /// oxlint's `--fix-suggestions` and `--fix-dangerously`: a suggestion of a kind that they allow is as good as a fix.
    /// `--fix-suggestions` alone makes no other change, `--fix-dangerously` makes all.
    pub(crate) fn promote_suggestions(&self, result: &mut LintResult) {
        let options = self.options;
        if !options.fix_suggestions && !options.fix_dangerously {
            return;
        }
        let is_allowed = |it: &Suggestion| match it.kind {
            SuggestionKind::Suggestion => true,
            SuggestionKind::DangerousFix | SuggestionKind::DangerousSuggestion => {
                options.fix_dangerously
            }
        };
        for message in &mut result.messages {
            if !options.fix_safely && !options.fix_dangerously {
                message.fix = None;
            }
            if message.fix.is_none()
                && let Some(at) = message.suggestions.iter().position(is_allowed)
            {
                message.fix = Some(message.suggestions.swap_remove(at).fix);
                message.suggestions.clear();
            }
        }
    }

    /// Whether `--quiet` leaves the fixes of warnings alone: it only hides them from oxlint's report.
    fn fixes_warnings(&self) -> bool {
        self.of_oxlint.is_some() && self.fixes()
    }

    /// ESLint's `fix` option as `getFixerForFixTypes` makes it.
    pub(crate) fn should_fix(&self, message: &LintMessage) -> bool {
        if self.options.quiet && message.severity != Severity::Error && !self.fixes_warnings() {
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
        self.verify_as(path, text, config, &How::default())
    }

    /// The same for a block that a processor has found in a file, whose path is the first `physical_path_len` bytes of `path`.
    /// `without_fixes`: ESLint's `disableFixes`.
    pub(crate) fn verify_block_natively(
        &self,
        path: &[u8],
        physical_path_len: usize,
        text: &[u8],
        config: &ResolvedConfig,
        without_fixes: bool,
    ) -> LintResult {
        let how = How {
            without_fixes,
            physical_path_len: Some(physical_path_len),
            ..How::default()
        };
        self.verify_as(path, text, config, &how)
    }

    /// The same for a script in the file at `path`, in the language `kind`. Only the rules run of which `filter` says so.
    pub(crate) fn verify_script(
        &self,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
        (kind, vue_script): (ScriptKind, VueScript),
        filter: &RuleFilter,
    ) -> LintResult {
        let how = How {
            script: Some((kind, filter)),
            vue_script,
            ..How::default()
        };
        self.verify_as(path, text, config, &how)
    }

    /// Runs the rules in JavaScript on a file for nothing but that an engine has loaded them, and what they load when they
    /// first run.
    pub(crate) fn warm_up_an_engine(&self, target: &Target) {
        let Status::Matched(config) = &target.status else {
            return;
        };
        let Ok(text) = fs::read_sized(&target.path, target.size) else {
            return;
        };
        let of_the_run = self.lint_options().rule_filter;
        let only = |id: &RuleId, severity: Severity| {
            matches!(id, RuleId::Js(_)) && of_the_run.is_none_or(|it| it(id, severity))
        };
        let how = How {
            without_fixes: true,
            only: Some(&only),
            ..How::default()
        };
        self.verify_as(&target.path, &text, config, &how);
    }

    /// Lints a file again that `modules` names when all files are linted.
    pub(crate) fn lint_again(&self, result: &mut FileResult) -> Result<(), Fatal> {
        let Some(config) = result.linted.as_ref().map(|it| Arc::clone(&it.config)) else {
            return Ok(());
        };
        let path = paths::from_native(&result.path);
        let text = match result.text.take() {
            Some(text) => text,
            None => fs::read(&path).map_err(|error| {
                Fatal([b"Cannot read ", &path[..], b": ", &fs::describe(&error)].concat())
            })?,
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
        let how = How {
            again: Some(again),
            ..How::default()
        };
        let framework = Framework::of(&path).filter(|_| config.language.is_oxlint);
        let linted = match framework {
            // Its scripts are linted one by one, so all rules run once more.
            Some(framework) => self.verify_scripts(framework, &path, &text, &config),
            None => self.verify_as(&path, &text, &config, &how),
        };
        let (had_types, was_fixed) = (result.had_types, result.is_fixed);
        let shown = std::mem::take(&mut result.path);
        // What the other files export is known now, so all rules can run on what the fixes make of the text. Its types are gone.
        let mut fixable = linted.messages.iter().filter(|it| it.fix.is_some());
        *result = match self.fixes() && !had_types && fixable.any(|it| self.should_fix(it)) {
            true => self.verify_text_by(shown, &path, text, &config, &|_| (), &mut |text| {
                match framework {
                    Some(framework) => self.verify_scripts(framework, &path, text, &config),
                    None => self.verify(&path, text, &config),
                }
            }),
            false => self.result(shown, linted, text, was_fixed, &config),
        };
        result.is_fixed |= was_fixed;
        result.had_types = had_types;
        Ok(())
    }

    fn verify_as(
        &self,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
        as_what: &How,
    ) -> LintResult {
        let started = self.timing.now();
        let session = self.memory;
        let arena = session.arena();
        let how = config.language.parse_options(path);
        bun_js_parser::sema::with_summary(
            how.dialect,
            (arena, session),
            path,
            as_what.script.map(|it| it.0).or(how.script_kind),
            text,
            self.atoms.of_this_thread(),
            how.experimental_decorators,
            how.every_file_is_a_module,
            |hir, atoms| {
                let bind_options = BindOptions {
                    emit_standard_class_fields: true,
                    before_es2020: false,
                    before_es2017: false,
                };
                let mut recycled = Recycled::of_this_thread();
                let bound = bind_for_lint_in(&hir, bind_options, atoms, &mut recycled);
                let parsed = self.timing.add(&self.timing.parse, started);
                if hir.mentioned.is_empty() {
                    self.timing.count(&self.timing.without_filter);
                }
                if hir.ran_out_of_stack || bound.ran_out_of_stack {
                    return LintResult {
                        messages: vec![too_deep()],
                        ..LintResult::default()
                    };
                }
                let file = File::new(path, &hir, bound, atoms, &config.language, None);
                file.set_modules(self.modules);
                file.set_vue_script(as_what.vue_script);
                let options = self.lint_options();
                let options = LintOptions {
                    again: as_what.again,
                    wants_fixes: options.wants_fixes && !as_what.without_fixes,
                    physical_path_len: as_what.physical_path_len,
                    rule_filter: (as_what.script.map(|it| it.1))
                        .or(as_what.only)
                        .or(options.rule_filter),
                    ..options
                };
                let mut result = self.linter.lint(&file, config, &options);
                self.promote_suggestions(&mut result);
                self.timing.add(&self.timing.rules, parsed);
                result
            },
        )
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
        self.verify_text_by(
            path,
            path_to_verify,
            text,
            config,
            on_circular_fixes,
            &mut |text| self.verify(path_to_verify, text, config),
        )
    }

    /// The same. `verify`: lints a text.
    pub(crate) fn verify_text_by(
        &self,
        path: Vec<u8>,
        path_to_verify: &[u8],
        text: Vec<u8>,
        config: &Arc<ResolvedConfig>,
        on_circular_fixes: &dyn Fn(&[u8]),
        verify: &mut dyn FnMut(&[u8]) -> LintResult,
    ) -> FileResult {
        let (result, text, is_fixed) = match self.fixes() {
            false => (verify(&text), text, false),
            true => {
                let report = bun_lint::linter::verify_and_fix(
                    &text,
                    &|message| self.should_fix(message),
                    verify,
                );
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
            text: (is_fixed || (self.keeps_text && is_reported)).then_some(text),
            messages: result.messages,
            suppressed: result.suppressed,
            thrown: result.thrown,
            had_types: false,
            is_fixed,
            linted: Some(Linted {
                config: Arc::clone(config),
                has_source: !is_fixed && counts.errors + counts.warnings > 0,
            }),
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
        let text = match fs::read_sized(&target.path, target.size) {
            Ok(text) => text,
            // A link that leads nowhere. oxlint passes over it.
            Err(_)
                if target.loaded.flavor == Flavor::Oxlint && fs::kind(&target.path).is_none() =>
            {
                return Ok(None);
            }
            Err(error) => {
                return Err(Fatal(
                    [
                        b"Cannot read ",
                        &target.path[..],
                        b": ",
                        &fs::describe(&error),
                    ]
                    .concat(),
                ));
            }
        };
        self.timing.add(&self.timing.read, started);
        let shown = paths::to_native(target.path.clone());
        if let Some(framework) = target.framework() {
            return Ok(Some(self.verify_text_by(
                shown,
                &target.path,
                text,
                config,
                on_circular_fixes,
                &mut |text| self.verify_scripts(framework, &target.path, text, config),
            )));
        }
        if target.has_processor() {
            return Ok(Some(self.verify_processed_text(
                &target.loaded,
                shown,
                &target.path,
                text,
                config,
                on_circular_fixes,
            )));
        }
        Ok(Some(self.verify_text(
            shown,
            &target.path,
            text,
            config,
            on_circular_fixes,
        )))
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
        ..LintMessage::default()
    }
}

/// How long since `started`, if time is measured.
pub(crate) fn elapsed(started: Option<Instant>) -> u64 {
    started.map_or(0, |started| started.elapsed().as_nanos() as u64)
}
