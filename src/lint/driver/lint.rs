//! Lints one file that needs no types: reads it, parses it, binds it, runs the rules, and applies fixes. Everything but
//! the messages is freed before the next file.

use crate::cli::{FixType, Options};
use crate::configs::{Flavor, Loaded};
use crate::discover::{Status, Target};
use crate::embedded::Framework;
use crate::inferred::Inferred;
use crate::results::{Counts, FileResult, Linted};
use crate::run::{Fatal, Timing};
use crate::{Linter, fs, git, paths};
use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::context::Severity;
use bun_lint::fix::SuggestionKind;
use bun_lint::formats::{Formats, Reason};
use bun_lint::js_plugin::{Host, ParseAgain, Route};
use bun_lint::language::Parser;
use bun_lint::languages::{Dialect, LineBreaks, Parsed};
use bun_lint::linter::{
    Again, LintMessage, LintOptions, LintResult, ResolvedConfig, RuleId, Suggestion, apply_fixes,
    is_parse_error, is_redeclaration, may_be_misread, redeclarations,
};
use bun_lint::rule::{Kind, Plugin};
use bun_lint_graph::Graph;
use bun_sema::atom::Intern;
use bun_sema::bind::{BindOptions, Recycled, bind_for_lint_in};
use bun_sema::resolve::ScriptKind;
use bun_sema::session::Session;
use bun_threading::Guarded;
use std::sync::Arc;
use std::time::Instant;

/// State shared by all files in a run.
pub(crate) struct Context<'c, 'm> {
    pub(crate) linter: &'c Linter,
    pub(crate) options: &'c Options,
    pub(crate) cwd: &'c [u8],
    /// `--staged`, `--changed`
    pub(crate) only: Option<&'c git::Files<'c>>,
    /// The working directory's config, if it's an oxlint config.
    pub(crate) oxlint_config: Option<&'c Loaded>,
    /// `--type-check`: also report the type checker's errors.
    pub(crate) checks_types: bool,
    /// True if [`FileResult::text`] is read.
    pub(crate) keeps_text: bool,
    /// True if the messages' fixes and suggestions are read, even if only to count them.
    pub(crate) reads_fixes: bool,
    /// True if they're printed.
    pub(crate) reads_fix_texts: bool,
    /// True if oxlint's help is read.
    pub(crate) reads_help: bool,
    /// Help is only read for the few problems that are shown with their code. Generating it for every problem takes
    /// longer than finding the problems, so it's generated when one is printed. See [`Context::with_help`].
    pub(crate) help_on_demand: bool,
    /// True if the output shows which comments suppress a message.
    pub(crate) reads_suppressions: bool,
    /// Runs the rules written in JavaScript.
    pub(crate) js_plugins: &'c Host<'c>,
    /// Rules that comments turn on but that didn't run, because their plugins aren't loaded.
    pub(crate) skipped_in_comments: &'c Guarded<Vec<Box<[u8]>>>,
    /// Files in which the type checker ran out of stack, so rules that need types may have missed something. Native
    /// paths.
    pub(crate) out_of_stack: &'c Guarded<Vec<Vec<u8>>>,
    /// Programs whose config file has no `include`, with native paths. See `typed::is_out_of_proportion`.
    pub(crate) without_include: &'c Guarded<Vec<bun_sema_driver::WithoutInclude>>,
    /// Files that fixes would have left with a syntax error, each with the rules whose fixes were dropped because of
    /// it.
    pub(crate) broken_fixes: &'c Guarded<Vec<(Vec<u8>, Vec<RuleId>)>>,
    /// Files and blocks that [may be misread](may_be_misread), when nothing else is available to parse them.
    pub(crate) unread: &'c Guarded<Vec<Vec<u8>>>,
    /// The files that only the `eslint` package can lint, when it isn't installed or the config isn't an `eslint.config.js`,
    /// which is the only kind that files are handed to `eslint` with. They get no result. Also the blocks that processors
    /// find in files, like `a.md/0_0.css`.
    pub(crate) needs_eslint: &'c Guarded<Vec<(Vec<u8>, Flavor)>>,
    /// Why files were [handed back](LintResult::handed_back), and how many for each reason.
    pub(crate) handed_back: &'c Guarded<Vec<(Reason, usize)>>,
    /// oxlint's errors about TypeScript config files that produced no program, so no rule that needs types ran on their
    /// files: `typescript(tsconfig-error)`.
    pub(crate) invalid_tsconfigs: &'c Guarded<crate::typed::InvalidTsconfigs>,
    /// The import graph, for rules that look at several files.
    pub(crate) modules: &'c Graph<'m>,
    /// `bun fmt`, for the rules that compare a file with its formatted text.
    pub(crate) formatter: &'c dyn Formats,
    /// The globals of the files' programs. `None` if no file in the run can look them up.
    pub(crate) inferred: Option<&'c Inferred<'c>>,
    pub(crate) timing: &'c Timing,
    /// The names in all files that are linted without types. They're freed when the run ends. Their size is bounded by
    /// the project's distinct names and strings.
    pub(crate) atoms: &'c dyn Intern,
    /// Holds a file's lists while it's linted. They're freed one by one when the file is done, because a separate heap
    /// per file would start with fresh pages every time.
    pub(crate) memory: &'c Session,
}

/// ESLint's `ruleFilter`.
pub(crate) type RuleFilter<'f> = dyn Fn(&RuleId, Severity) -> bool + Sync + 'f;

/// Selects the fixes and suggestions that the built-in rules produce.
#[derive(Copy, Clone, Default, PartialEq, Eq)]
pub(crate) enum Fixes {
    /// The ones the run reads.
    #[default]
    IfRead,
    /// All of them, because they're passed to a processor.
    ForProcessor,
    /// ESLint's `disableFixes`: none, and JavaScript rules aren't asked for any either.
    Disabled,
}

/// Selects the rules to run.
#[derive(Copy, Clone, Default)]
enum Which<'h> {
    /// The config's rules.
    #[default]
    All,
    /// None. The caller only wants to know whether the text parses.
    None,
    /// [`Context::with_help`]
    WithHelp(&'h RuleFilter<'h>),
}

/// Overrides for linting a text differently from a plain file.
#[derive(Copy, Clone, Default)]
struct How<'h> {
    /// See [`LintOptions::again`].
    again: Option<Again<'h>>,
    fixes: Fixes,
    /// See [`LintOptions::physical_path_len`].
    physical_path_len: Option<usize>,
    /// Set if it's a script inside a file: its language, and which rules run.
    script: Option<(ScriptKind, &'h RuleFilter<'h>)>,
    /// [`File::is_later_script`]
    is_later_script: bool,
    /// Set if the file isn't JavaScript: the arguments of [`File::in_language`].
    in_language: Option<(&'h [u8], &'h Parsed, LineBreaks)>,
    rules: Which<'h>,
    /// True if the text is the output of a fix pass.
    is_fixed: bool,
}

fn only_errors(_: &RuleId, severity: Severity) -> bool {
    severity == Severity::Error
}

fn no_rule(_: &RuleId, _: Severity) -> bool {
    false
}

/// Treats the removal of a disable comment that disables nothing the way oxlint does. In a script in a `.vue`, `.astro`
/// or `.svelte` file, `--fix` and the two other flags all remove it. In any other file it's never removed.
pub(crate) fn unused_directives_as_oxlint(result: &mut LintResult, is_script: bool) {
    for message in result.messages.iter_mut().filter(|it| it.rule_id.is_none()) {
        match is_script {
            true => message.fix = message.suggestions.first().map(|it| it.fix.clone()),
            false => message.suggestions.clear(),
        }
    }
}

/// Takes the messages in the order oxlint reports them, and sorts them like its `Fixer::fix` does if one has a fix: by
/// the fix's range, with messages without a fix first. oxlint applies the fixes in that order and prints the remaining
/// messages in it.
///
/// oxlint's sort isn't stable, which shows from 33 messages up: messages without a fix don't keep their order. Here
/// they do.
pub(crate) fn order_fixes_as_oxlint(messages: &mut [LintMessage]) {
    if messages.iter().all(|it| it.fix.is_none()) {
        return;
    }
    let range = |it: &LintMessage| it.fix.as_ref().map(|it| (it.span.start, it.span.end));
    bun_lint::utils::sort::sort_by_key(messages, |it| range(it).unwrap_or_default());
    for (it, reported) in messages.iter_mut().zip(1..) {
        it.reported = reported;
    }
}

impl Context<'_, '_> {
    pub(crate) fn lint_options(&self) -> LintOptions<'_> {
        LintOptions {
            allow_inline_config: self.options.inline_config,
            // It's part of the config. See `Loader::override_config`.
            report_unused_disable_directives: None,
            wants_fixes: self.fixes() || self.reads_fixes,
            wants_fix_texts: self.fixes() || self.reads_fix_texts,
            wants_help: self.reads_help,
            wants_messages: !self.options.silent,
            wants_positions: !self.options.silent,
            wants_suppressions: self.reads_suppressions,
            // Warnings have to be counted for `--max-warnings`, and for oxlint, where `--quiet` only hides them from
            // the report.
            rule_filter: match self.options.quiet
                && self.options.max_warnings == -1
                && self.oxlint_config.is_none()
            {
                true => Some(&only_errors),
                false => None,
            },
            js_plugins: Some(self.js_plugins),
            respects_eslint_comments: self
                .oxlint_config
                .is_none_or(|it| it.respects_eslint_comments),
            ..LintOptions::default()
        }
    }

    pub(crate) fn fixes(&self) -> bool {
        self.options.fix || self.options.fix_dry_run
    }

    /// True if fixes are applied to the file at `path`. A partly staged file won't be written, so its problems are
    /// reported unfixed.
    pub(crate) fn fixes_file(&self, path: &[u8]) -> bool {
        let writes_files = self.options.fix;
        self.fixes() && !(writes_files && self.only.is_some_and(|it| it.is_partly_staged(path)))
    }

    /// oxlint's `--fix-suggestions` and `--fix-dangerously`: a suggestion of a kind they allow is treated as a fix.
    /// `--fix-suggestions` on its own applies nothing else, except JavaScript plugins' fixes, which oxlint applies
    /// under any of the three flags. `--fix-dangerously` applies everything.
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
            let is_from_js_plugin = matches!(message.rule_id, Some(RuleId::Js(_)));
            if !options.fix_safely && !options.fix_dangerously && !is_from_js_plugin {
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

    /// True if warnings are fixed even with `--quiet`, which only hides them from oxlint's report.
    fn fixes_warnings(&self) -> bool {
        self.oxlint_config.is_some() && self.fixes()
    }

    /// ESLint's `fix` option as built by `getFixerForFixTypes`.
    pub(crate) fn should_fix(&self, message: &LintMessage) -> bool {
        if self.options.quiet && message.severity != Severity::Error && !self.fixes_warnings() {
            return false;
        }
        let Some(types) = &self.options.fix_type else {
            return true;
        };
        types.contains(&match &message.rule_id {
            None => FixType::Directive,
            Some(RuleId::Known(meta) | RuleId::Named(meta, _)) => match meta.kind {
                Kind::Problem => FixType::Problem,
                Kind::Suggestion => FixType::Suggestion,
                Kind::Layout => FixType::Layout,
                Kind::None => return false,
            },
            Some(RuleId::Js(rule)) => match rule.kind {
                Some(Kind::Problem) => FixType::Problem,
                Some(Kind::Suggestion) => FixType::Suggestion,
                Some(Kind::Layout) => FixType::Layout,
                Some(Kind::None) | None => return false,
            },
            Some(RuleId::Unknown(_)) => return false,
        })
    }

    /// ESLint's `createIgnoreResult`. `flavor` is the flavor of the config that ignores the file.
    pub(crate) fn ignored(&self, path: &[u8], status: &Status, flavor: Flavor) -> FileResult {
        let message: &[u8] = match status {
            Status::External => b"File ignored because outside of base path.",
            Status::Unconfigured => b"File ignored because no matching configuration was supplied.",
            // ESLint 8's version looks at the whole path.
            _ if flavor == Flavor::EslintRc => {
                let is_hidden = strings::split(path, b"/").any(|it| it.starts_with(b"."));
                if is_hidden {
                    b"File ignored by default.  Use a negated ignore pattern (like \"--ignore-pattern '!<relative/path/to/filename>'\") to override."
                } else if paths::relative(self.cwd, path).starts_with(b"node_modules") {
                    b"File ignored by default. Use \"--ignore-pattern '!node_modules/*'\" to override."
                } else {
                    b"File ignored because of a matching ignore pattern. Use \"--no-ignore\" to override."
                }
            }
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

    /// Lints `text` for one pass of `--fix`, like [`Self::verify`]. `is_fixed` is true if the previous pass produced
    /// `text`.
    pub(crate) fn verify_pass(
        &self,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
        is_fixed: bool,
    ) -> LintResult {
        let how = How {
            is_fixed,
            ..How::default()
        };
        self.verify_as(path, text, config, &how)
    }

    /// Adds `file`'s [`redeclarations`] to [`LintResult::tolerated_errors`], so that fixes that declare a name twice
    /// are reverted. Only counts them when two texts will be compared: fixes produced this one (`is_fixed`), or it has
    /// a fix that will be applied.
    pub(crate) fn count_redeclarations<'f>(
        &self,
        file: &'f File<'f>,
        result: &mut LintResult,
        is_fixed: bool,
    ) {
        // oxlint only runs one fix pass, and it does write `const a = 1; const a = 2;` for two `var`s.
        let is_compared = self.fixes() && !file.language().is_oxlint;
        if !is_compared || result.messages.iter().any(|it| it.is_fatal) {
            return;
        }
        let is_applied = |it: &LintMessage| it.fix.is_some() && self.should_fix(it);
        if is_fixed || result.messages.iter().any(is_applied) {
            result.tolerated_errors += redeclarations(file);
        }
    }

    /// Lints the text behind `result`'s messages again, this time generating oxlint's help for each message. Returns
    /// nothing if the help was generated the first time or there isn't any. See [`Context::help_on_demand`]. `only`
    /// lists the rules to run.
    pub(crate) fn with_help(
        &self,
        result: &FileResult,
        only: Option<&[&RuleId]>,
    ) -> Vec<LintMessage> {
        let (Some(linted), Some(text)) = (&result.linted, &result.text) else {
            return Vec::new();
        };
        let path = paths::from_native(&result.path);
        let was_made = result.had_types || Framework::of(&path).is_some();
        let has_extra_help = |it: &LintMessage| matches!(&it.rule_id, Some(RuleId::Known(meta) | RuleId::Named(meta, _)) if meta.plugin == Plugin::BunTest || meta.follows_oxlint || meta.has_hints);
        let has_help =
            linted.config.language.is_oxlint || result.messages.iter().any(has_extra_help);
        if was_made || !has_help || linted.config.dialect.is_some() {
            return Vec::new();
        }
        let is_requested = |id: &RuleId, _: Severity| only.is_none_or(|only| only.contains(&id));
        let how = How {
            rules: Which::WithHelp(&is_requested),
            ..How::default()
        };
        self.verify_as(&path, text, &linted.config, &how).messages
    }

    /// True if `text` parses as the file at `path`.
    pub(crate) fn parses(&self, path: &[u8], text: &[u8], config: &ResolvedConfig) -> bool {
        let how = How {
            rules: Which::None,
            ..How::default()
        };
        let result = match Framework::of(path).filter(|_| config.language.is_oxlint) {
            Some(framework) => {
                self.verify_scripts_filtered(framework, path, text, config, Some(&no_rule))
            }
            None => self.verify_as(path, text, config, &how),
        };
        // oxc's parser accepts a name that's declared twice, and oxlint writes `const a = 1; const a = 2;` for two
        // `var`s.
        let is_rejected = |it: &LintMessage| is_parse_error(it) && !is_redeclaration(it);
        !result.messages.iter().any(is_rejected)
    }

    /// Records that the fixes of `rules` would have left the file at `path` with a syntax error.
    pub(crate) fn note_broken_fixes(&self, path: &[u8], rules: Vec<RuleId>) {
        self.broken_fixes.lock().push((path.to_vec(), rules));
    }

    /// Like [`Self::verify`], for a block that a processor found in a file. The file's path is the first
    /// `physical_path_len` bytes of `path`. `None` if the block [may be misread](may_be_misread), in which case no rule
    /// ran.
    pub(crate) fn verify_block_if_read(
        &self,
        path: &[u8],
        physical_path_len: usize,
        text: &[u8],
        config: &ResolvedConfig,
        fixes: Fixes,
    ) -> Option<LintResult> {
        let how = How {
            fixes,
            physical_path_len: Some(physical_path_len),
            ..How::default()
        };
        Some(self.verify_as(path, text, config, &how)).filter(|it| !it.needs_another_linter)
    }

    /// Like [`Self::verify`], for text in `dialect`, which isn't JavaScript. `physical_path_len` is set if the text is
    /// a block that a processor found, as in `verify_block_if_read`.
    pub(crate) fn verify_in_language(
        &self,
        path: &[u8],
        physical_path_len: Option<usize>,
        text: &[u8],
        (config, dialect): (&ResolvedConfig, &Dialect),
        fixes: Fixes,
    ) -> LintResult {
        let started = self.timing.now();
        let body = text.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(text);
        let parsed = match dialect.language.parse(body, &dialect.configured) {
            Ok(parsed) => parsed,
            Err(errors) => {
                self.timing.add(&self.timing.parse, started);
                let fatal = |it: bun_lint::languages::SyntaxError| LintMessage {
                    message: [&b"Parsing error: "[..], &it.message].concat(),
                    line: it.line,
                    column: it.column,
                    ..too_deep()
                };
                return LintResult {
                    messages: errors.into_iter().map(fatal).collect(),
                    ..LintResult::default()
                };
            }
        };
        self.timing.add(&self.timing.parse, started);
        let how = How {
            fixes,
            physical_path_len,
            in_language: Some((body, &parsed, dialect.language.line_breaks())),
            ..How::default()
        };
        let mut result = self.verify_as(path, body, config, &how);
        // The language parsed the text without the byte order mark, so shift the fixes by its length.
        let mark = (text.len() - body.len()) as u32;
        if mark > 0 {
            result.line_starts = None;
            for message in result.messages.iter_mut().chain(&mut result.suppressed) {
                let suggested = message.suggestions.iter_mut().map(|it| &mut it.fix);
                for fix in message.fix.iter_mut().chain(suggested) {
                    fix.span.start += mark;
                    fix.span.end += mark;
                }
            }
        }
        result
    }

    /// Like [`Self::verify`], for a script in the file at `path`, in the language `kind`. Only the rules that `filter`
    /// accepts run.
    pub(crate) fn verify_script(
        &self,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
        (kind, is_later_script): (ScriptKind, bool),
        filter: &RuleFilter,
    ) -> LintResult {
        let how = How {
            script: Some((kind, filter)),
            is_later_script,
            ..How::default()
        };
        self.verify_as(path, text, config, &how)
    }

    /// Lints a file again. `modules` lists the files that need it once every file has been linted.
    pub(crate) fn lint_again(&self, result: &mut FileResult) -> Result<(), Fatal> {
        let Some(config) = result.linted.as_ref().map(|it| Arc::clone(&it.config)) else {
            return Ok(());
        };
        let path = paths::from_native(&result.path);
        let text = match result.text.take() {
            Some(text) => text,
            None => git::read(self.only, &path).map_err(|error| {
                Fatal([b"Cannot read ", &path[..], b": ", &fs::describe(&error)].concat())
            })?,
        };
        // Type errors don't come from a rule, so the second pass can't carry them over. No comment disables them either.
        let (type_errors, messages): (Vec<LintMessage>, Vec<LintMessage>) =
            (std::mem::take(&mut result.messages).into_iter())
                .partition(crate::typed::is_type_error);
        let previous = LintResult {
            messages,
            suppressed: std::mem::take(&mut result.suppressed),
            run_keys: std::mem::take(&mut result.run_keys),
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
        let mut linted = match framework {
            // Its scripts are linted one by one, so all the rules run again.
            Some(framework) => self.verify_scripts(framework, &path, &text, &config),
            None => self.verify_as(&path, &text, &config, &how),
        };
        if !type_errors.is_empty() {
            linted.messages.extend(type_errors);
            LintMessage::sort(&mut linted.messages);
        }
        let (had_types, was_fixed, fixes) = (result.had_types, result.is_fixed, result.fixes);
        let fixed_text = result.fixed_text.take();
        let display_path = std::mem::take(&mut result.path);
        // The other files' exports are known now, so all the rules can run on the fixed text. Its types are gone.
        let mut fixable = linted.messages.iter().filter(|it| it.fix.is_some());
        let is_fixed_now = self.fixes_file(&path) && !had_types;
        *result = match is_fixed_now && fixable.any(|it| self.should_fix(it)) {
            true => {
                let mut verify = |text: &[u8], is_fixed: bool| match framework {
                    Some(framework) => self.verify_scripts(framework, &path, text, &config),
                    None => self.verify_pass(&path, text, &config, is_fixed),
                };
                let text = (text, was_fixed);
                self.verify_text_by(display_path, &path, text, &config, &|_| (), &mut verify)
            }
            false => self.result(display_path, linted, text, was_fixed, &config),
        };
        result.fixed_text = result.fixed_text.take().or(fixed_text);
        result.fixes += fixes;
        result.had_types = had_types;
        Ok(())
    }

    /// Parses `text` as the file at `path` on the calling thread, and calls `then` with the file. `then` gets `None` if the
    /// code is nested too deeply.
    fn parse(
        &self,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
        as_what: &How,
        then: &mut dyn for<'f> FnMut(Option<&'f File<'f>>),
    ) {
        let started = self.timing.now();
        let session = self.memory;
        let arena = session.arena();
        let how = config.language.parse_options(path);
        let (script_kind, text) = match as_what.in_language {
            Some(_) => (Some(ScriptKind::Js), &b""[..]),
            None => (as_what.script.map(|it| it.0).or(how.script_kind), text),
        };
        bun_sema_parser::with_summary(
            how.dialect,
            (arena, session),
            path,
            script_kind,
            text,
            self.atoms.for_current_thread(),
            how.experimental_decorators,
            how.every_file_is_a_module,
            |hir, atoms| {
                let bind_options = BindOptions {
                    emit_standard_class_fields: true,
                    before_es2020: false,
                    before_es2017: false,
                };
                let mut recycled = Recycled::for_current_thread();
                let bound = bind_for_lint_in(&hir, bind_options, atoms, &mut recycled);
                self.timing.add(&self.timing.parse, started);
                if hir.mentioned.is_empty() {
                    self.timing.count(&self.timing.without_filter);
                }
                if hir.ran_out_of_stack || bound.ran_out_of_stack {
                    return then(None);
                }
                let file = File::new(path, &hir, bound, atoms, &config.language, None);
                let file = match as_what.in_language {
                    Some((text, parsed, breaks)) => file.in_language(text, parsed, breaks),
                    None => file,
                };
                file.set_modules(self.modules);
                // Given the component's file name, the formatter would print one of its scripts as a component.
                if as_what.script.is_none() {
                    file.set_formatter(self.formatter, as_what.physical_path_len);
                }
                if let Some(inferred) = self.inferred {
                    file.set_inferred_globals(inferred);
                }
                file.set_later_script(as_what.is_later_script);
                then(Some(&file));
            },
        );
    }

    /// [`ParseAgain`] for the file at `path`.
    pub(crate) fn parse_again(
        &self,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
        then: &mut dyn for<'f> FnMut(&'f File<'f>),
    ) {
        self.parse_again_as(path, text, config, &How::default(), then);
    }

    fn parse_again_as(
        &self,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
        as_what: &How,
        then: &mut dyn for<'f> FnMut(&'f File<'f>),
    ) {
        self.parse(path, text, config, as_what, &mut |file| {
            if let Some(file) = file {
                then(file);
            }
        });
    }

    fn verify_as(
        &self,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
        as_what: &How,
    ) -> LintResult {
        let parse_again = |then: &mut dyn for<'f> FnMut(&'f File<'f>)| {
            self.parse_again_as(path, text, config, as_what, then);
        };
        let mut result = LintResult::default();
        self.parse(path, text, config, as_what, &mut |file| {
            result = match file {
                Some(file) => self.verify_parsed(file, config, as_what, &parse_again),
                None => LintResult {
                    messages: vec![too_deep()],
                    ..LintResult::default()
                },
            };
        });
        result
    }

    fn verify_parsed<'f>(
        &self,
        file: &'f File<'f>,
        config: &ResolvedConfig,
        as_what: &How,
        parse_again: &ParseAgain,
    ) -> LintResult {
        let parsed = self.timing.now();
        // This is a processor's block that may be misread. Don't lint it. The caller decides what to do with it.
        if as_what.physical_path_len.is_some() && may_be_misread(file) {
            return LintResult {
                needs_another_linter: true,
                ..LintResult::default()
            };
        }
        let options = self.lint_options();
        // Help on demand lints the text a second time. That only works for a file that's linted in one piece.
        let is_whole = as_what.script.is_none() && as_what.physical_path_len.is_none();
        let is_for_help = matches!(as_what.rules, Which::WithHelp(_));
        let defers_help = self.help_on_demand && is_whole && !is_for_help;
        let options = LintOptions {
            again: as_what.again,
            wants_fixes: match as_what.fixes {
                Fixes::IfRead => options.wants_fixes,
                Fixes::ForProcessor => true,
                Fixes::Disabled => false,
            },
            disables_fixes: as_what.fixes == Fixes::Disabled,
            // A block's messages are handed to its processor, so they have to be complete.
            wants_fix_texts: options.wants_fix_texts || as_what.physical_path_len.is_some(),
            wants_help: options.wants_help && !defers_help,
            wants_messages: options.wants_messages || as_what.physical_path_len.is_some(),
            wants_positions: options.wants_positions || as_what.physical_path_len.is_some(),
            // JavaScript rules have no help, so there's no reason to run them again.
            js_plugins: options.js_plugins.filter(|_| !is_for_help),
            parse_again: Some(parse_again),
            physical_path_len: as_what.physical_path_len,
            rule_filter: match (as_what.rules, as_what.script) {
                (Which::None, _) => Some(&no_rule),
                (_, Some(script)) => Some(script.1),
                (Which::WithHelp(only), None) => Some(only),
                (Which::All, None) => options.rule_filter,
            },
            ..options
        };
        let mut result = self.linter.lint(file, config, &options);
        if config.language.is_oxlint {
            unused_directives_as_oxlint(&mut result, as_what.script.is_some());
        }
        self.promote_suggestions(&mut result);
        if is_whole {
            self.count_redeclarations(file, &mut result, as_what.is_fixed);
        }
        // Fixes change the text, so these line starts wouldn't match the final one.
        if self.keeps_text && is_whole && !self.fixes() {
            result.line_starts = file.known_line_starts().map(<[u32]>::to_vec);
        }
        self.timing.add(&self.timing.rules, parsed);
        result
    }

    /// ESLint's `verifyText`. `path` is the path to print. `path_to_verify` is the path the file is linted as.
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
            (text, false),
            config,
            on_circular_fixes,
            &mut |text, is_fixed| self.verify_pass(path_to_verify, text, config, is_fixed),
        )
    }

    /// Like [`Self::verify_text`], but the caller supplies `verify`, which lints a text and is told whether the fixes
    /// being tried now produced that text. `was_fixed` is true if `text` isn't the file's content but the output of
    /// earlier fixes. It then has to be written even if the fixes tried now are reverted.
    pub(crate) fn verify_text_by(
        &self,
        path: Vec<u8>,
        path_to_verify: &[u8],
        (text, was_fixed): (Vec<u8>, bool),
        config: &Arc<ResolvedConfig>,
        on_circular_fixes: &dyn Fn(&[u8]),
        verify: &mut dyn FnMut(&[u8], bool) -> LintResult,
    ) -> FileResult {
        let (result, text, is_fixed, fixes) = match self.fixes_file(path_to_verify) {
            false => (verify(&text, false), text, false, 0),
            true if config.language.is_oxlint => {
                let mut result = verify(&text, false);
                let mut messages = std::mem::take(&mut result.messages);
                order_fixes_as_oxlint(&mut messages);
                let fixed = apply_fixes(&text, messages, &|message| self.should_fix(message));
                if fixed.is_fixed && !self.parses(path_to_verify, &fixed.output, config) {
                    self.note_broken_fixes(path_to_verify, fixed.applied);
                    return self.result(path, verify(&text, false), text, was_fixed, config);
                }
                result.messages = fixed.remaining;
                // They're sorted by location now, so put them back in reported order.
                bun_lint::utils::sort::sort_by_key(&mut result.messages, |it| it.reported);
                let is_fixed = fixed.is_fixed || was_fixed;
                let mut result = self.result(path, result, text, is_fixed, config);
                result.fixed_text = fixed.is_fixed.then_some(fixed.output);
                result.fixes = fixed.count;
                return result;
            }
            true => {
                let report = bun_lint::linter::verify_and_fix(
                    &text,
                    &|message| self.should_fix(message),
                    verify,
                );
                if report.is_circular {
                    on_circular_fixes(path_to_verify);
                }
                if let Some(rules) = report.broken_by {
                    self.note_broken_fixes(path_to_verify, rules);
                }
                (report.result, report.output, report.is_fixed, report.fixes)
            }
        };
        let mut result = self.result(path, result, text, is_fixed || was_fixed, config);
        result.fixes = fixes;
        result
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
        if config.may_hand_back() && text.len() < bun_lint::js_plugin::HEAVY {
            (self.js_plugins).report_realm_need(text.len() as u64, result.handed_back.is_some());
        }
        if let Some(reason) = result.handed_back {
            let mut all = self.handed_back.lock();
            match all.iter_mut().find(|it| it.0 == reason) {
                Some(entry) => entry.1 += 1,
                None => all.push((reason, 1)),
            }
        }
        if !result.skipped_rules.is_empty() {
            let mut all = self.skipped_in_comments.lock();
            for rule in result.skipped_rules {
                if !all.contains(&rule) {
                    all.push(rule);
                }
            }
        }
        FileResult {
            path,
            counts,
            text: (is_fixed || (self.keeps_text && is_reported)).then_some(text),
            line_starts: result.line_starts.filter(|_| !is_fixed && is_reported),
            run_keys: result.run_keys,
            messages: result.messages,
            suppressed: result.suppressed,
            thrown: result.thrown,
            had_types: false,
            is_fixed,
            fixes: 0,
            fixed_text: None,
            linted: Some(Linted {
                config: Arc::clone(config),
                has_source: !is_fixed && counts.errors + counts.warnings > 0,
            }),
            deprecated: None,
        }
    }

    /// ESLint's `lintFile`. `None` if there's nothing to report about the file.
    pub(crate) fn lint_file(
        &self,
        target: &Target,
        on_circular_fixes: &dyn Fn(&[u8]),
    ) -> Result<Option<FileResult>, Fatal> {
        let Status::Matched(config) = &target.status else {
            // oxlint silently skips such a file.
            let warns = self.options.warn_ignored && target.loaded.flavor != Flavor::Oxlint;
            let flavor = target.loaded.flavor;
            return Ok(warns.then(|| self.ignored(&target.path, &target.status, flavor)));
        };
        let started = self.timing.now();
        let text = match git::read(self.only, &target.path) {
            Ok(text) => text,
            Err(error) if matches!(target.loaded.flavor, Flavor::Oxlint | Flavor::BuiltIn) => {
                // The file was deleted after it was found. oxlint skips missing files.
                if fs::kind(&target.path).is_none() {
                    return Ok(None);
                }
                let number = format!(" (os error {})", error.errno);
                let printed = [error.msg().unwrap_or(b"unknown error"), number.as_bytes()].concat();
                let display_path = paths::to_native(target.path.clone());
                let belongs_to_file = target.loaded.flavor != Flavor::Oxlint;
                return Ok(Some(FileResult::unopened(
                    display_path,
                    &printed,
                    belongs_to_file,
                )));
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
        let display_path = paths::to_native(target.path.clone());
        if let Some(framework) = target.framework() {
            return Ok(Some(self.verify_text_by(
                display_path,
                &target.path,
                (text, false),
                config,
                on_circular_fixes,
                &mut |text, _| self.verify_scripts(framework, &target.path, text, config),
            )));
        }
        // With another parser, whether the file can be parsed here is only known once it's read.
        if target.route() != Route::Native || config.language.parser == Parser::Other {
            return Ok(self.verify_processed_text(
                &target.loaded,
                display_path,
                &target.path,
                text,
                config,
                on_circular_fixes,
            ));
        }
        Ok(Some(self.verify_text(
            display_path,
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

/// Nanoseconds since `started`, or 0 if time isn't measured.
pub(crate) fn elapsed(started: Option<Instant>) -> u64 {
    started.map_or(0, |started| started.elapsed().as_nanos() as u64)
}
