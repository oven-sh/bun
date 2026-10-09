//! What ESLint's `Linter` does around the rules: the configuration of a file, the comments that
//! change it (`eslint-disable`, `global`, `exported`, `eslint rule: ..`), and the globals.
//!
//! - [`Registry`]: the rules that exist.
//! - [`Config`]: the configuration of a run.
//! - [`ResolvedConfig`]: what is configured for one file.
//! - [`Linter::lint`]: ESLint's `Linter.verify` for a file that is parsed already.
//! - [`LintMessage`]: what it reports.
//! - [`parse_error`]: whether ESLint's parser refuses the file. [`File::has_parse_errors`] is not the answer to that.
//! - [`verify_and_fix`]: ESLint's `Linter.verifyAndFix`.
//! - [`globals`]: the global variables that a file does not declare.
//!
//! What finds the files, reads the configuration from disk, parses, prints and writes fixes is built
//! on top:
//!
//! ```ignore
//! let linter = Linter::new(Registry::new(&[bun_lint_eslint::RULES, bun_lint_typescript::RULES]));
//! let config = Config::from_flat_json(linter.registry(), directory_of_the_configuration, &json)?;
//! // On any thread, for each file:
//! let FileConfig::Matched(resolved) = config.get(linter.registry(), path) else { continue };
//! if let Some(message) = &resolved.error { /* ESLint refuses to run */ }
//! if resolved.route(path) != Route::Native { continue }
//! let how = resolved.language.parse_options(path); // The arguments of `summarize`.
//! let file = File::new(path, &hir, &bound, &atoms, &resolved.language, types);
//! let result = linter.lint(&file, &resolved, &LintOptions::default());
//! ```

mod comment;
pub mod config;
mod directives;
mod disable;
mod disable_oxlint;
mod fixer;
pub mod globals;
mod json_v8;
mod levn;
mod message;
mod per_file;
mod registry;
mod resolved;
mod schema;
mod space;
mod syntax;

pub use config::{
    Config, ConfigError, FileConfig, Glob, LegacyFile, LegacyKind, LegacyOptions, LoadLegacy,
    LoadLocatedPlugin, LoadPlugin, RcFlavor, oxlint_category,
};
pub use fixer::{
    FixReport, Fixed, MAX_AUTOFIX_PASSES, apply_fixes, grows_too_much, max_fixed_len,
    verify_and_fix,
};
pub use globals::{CommentGlobal, GlobalVariable};
pub use levn::parse_object as parse_levn_object;
pub use message::{
    Details, LintMessage, RuleId, Suggestion, Suppression, SuppressionKind, Utf16Offsets,
    write_json, write_json_string,
};
pub(crate) use per_file::PerFile;
pub use registry::{
    Registry, oxlint_category_of_key, oxlint_filter_keys, oxlint_rule_key, parse_rule_id,
    plugin_of_oxlint,
};
pub use resolved::{ConfiguredJsRule, ConfiguredRule, LinterOptions, ResolvedConfig, severity_of};
pub(crate) use space::trim as trim_js_space;
pub use syntax::{
    Refusal, TypesInJavaScript, goes_to_flow, not_in_a_project, parse_error, refusal_of_oxfmt,
    refusal_of_prettier, refused_by_prettier, refused_by_prettier_with,
};

use crate::ast::File;
use crate::context::{Diagnostic, Severity};
use crate::js_plugin;
use crate::options::{Json, Options};
use crate::rule::Meta;
use crate::runner::{AnyRule, Enabled, RuleEntry};
use crate::span::Span;
use directives::{ConfigComment, Label};
use message::Locator;
use std::borrow::Cow;
use std::sync::Arc;

/// What a test of this module can reach of its parts.
#[doc(hidden)]
pub mod testing {
    pub use super::comment::{
        parse_directive, parse_json_like_config, parse_list_config, parse_string_config,
    };
    pub use super::json_v8::parse as json_parse;
    pub use super::message::write_json;
    pub use super::schema::{validate_by_id, validate_js};
    pub use super::syntax::{diagnostics, refusal_of_prettier_by_kind};
}

/// ESLint's `VerifyOptions`: what the command line says about how to lint.
#[derive(Copy, Clone)]
pub struct LintOptions<'o> {
    /// `false`: `--no-inline-config`. Comments are ignored, silently.
    pub allow_inline_config: bool,
    /// `--report-unused-disable-directives-severity`, which overrides the configuration.
    pub report_unused_disable_directives: Option<Severity>,
    /// Whether anything reads [`LintMessage::fix`] and [`LintMessage::suggestions`].
    pub wants_fixes: bool,
    /// Whether anything reads what is in [`LintMessage::suppressions`]. If not, a message that comments suppress has one of
    /// them, not one for each comment that is in effect: n comments that disable and n messages make n² of them.
    pub wants_suppressions: bool,
    /// ESLint's `ruleFilter`: which of the enabled rules run. `--quiet` leaves out those that warn.
    pub rule_filter: Option<&'o (dyn Fn(&RuleId, Severity) -> bool + Sync)>,
    /// Runs the rules of JavaScript plugins. `None`: they are skipped.
    pub js_plugins: Option<&'o js_plugin::Host<'o>>,
    /// The file is linted again, for the rules that are about several files only.
    pub again: Option<Again<'o>>,
    /// How much of the path of the file is ESLint's `physicalFilename`, if not all of it: it is a block that a processor has
    /// found in the file there.
    pub physical_path_len: Option<usize>,
    /// `false`: `options.respectEslintDisableDirectives` of an `.oxlintrc.json` is. Only comments that start with `oxlint` count.
    pub respects_eslint_comments: bool,
}

/// See [`LintOptions::again`]. Only the rules with [`Meta::needs_modules`](crate::rule::Meta::needs_modules) run. What the
/// other rules have reported is taken over, and the comments of the file are applied to all of it.
#[derive(Copy, Clone)]
pub struct Again<'o> {
    /// What [`Linter::lint`] returned the first time.
    pub previous: &'o LintResult,
    /// The first time the file had types.
    pub had_types: bool,
}

impl Default for LintOptions<'_> {
    fn default() -> Self {
        LintOptions {
            allow_inline_config: true,
            report_unused_disable_directives: None,
            wants_fixes: true,
            wants_suppressions: true,
            rule_filter: None,
            js_plugins: None,
            again: None,
            physical_path_len: None,
            respects_eslint_comments: true,
        }
    }
}

/// What [`Linter::lint`] returns.
#[derive(Default, Debug)]
pub struct LintResult {
    /// Sorted by position.
    pub messages: Vec<LintMessage>,
    /// ESLint's `suppressedMessages`: what `eslint-disable` comments hide.
    pub suppressed: Vec<LintMessage>,
    /// Rules that comments of the file name, and that belong to a plugin that is configured but
    /// not implemented here. They are skipped.
    pub skipped_rules: Vec<Box<[u8]>>,
    /// ESLint throws this while it lints the file, and that ends the run with the exit code 2: a rule refuses options that its
    /// schema accepts ([`Rule::validate`](crate::rule::Rule::validate)), or a rule of a JavaScript plugin throws. There is
    /// nothing else in the result then.
    pub thrown: Option<Vec<u8>>,
}

pub struct Linter {
    registry: Registry,
}

/// A rule as it runs on the file: as it is configured, or as a comment changes that.
struct Running<'r> {
    entry: &'static RuleEntry,
    /// [`ConfiguredRule::reported_as`]
    reported_as: &'static Meta,
    severity: Severity,
    rule: RuleRef<'r>,
    /// [`ConfiguredRule::refusal`]
    refusal: Option<Cow<'r, [u8]>>,
}

enum RuleRef<'r> {
    Shared(&'r dyn AnyRule),
    /// Made for this file, from the options in a comment.
    Own(Box<dyn AnyRule>),
}

/// The same for a rule of a JavaScript plugin.
struct RunningJs<'r> {
    severity: Severity,
    configured: Cow<'r, Arc<js_plugin::Configured>>,
}

/// A rule that a configuration or a comment names.
#[derive(Copy, Clone)]
enum Named<'c> {
    Native(&'static RuleEntry),
    Js(&'c Arc<js_plugin::Rule>),
}

impl Named<'_> {
    fn id(self) -> RuleId {
        match self {
            Named::Native(entry) => RuleId::Known(entry.meta),
            Named::Js(rule) => RuleId::Js(Arc::clone(rule)),
        }
    }

    fn is(self, other: Named) -> bool {
        match (self, other) {
            (Named::Native(a), Named::Native(b)) => is_same_rule(a, b),
            (Named::Js(a), Named::Js(b)) => Arc::ptr_eq(a, b),
            _ => false,
        }
    }

    /// [`schema::validate`]. `Ok`: what a rule of a JavaScript plugin gets as its options.
    fn validate(self, options: &[Json]) -> Result<Vec<Json>, Vec<u8>> {
        match self {
            Named::Native(entry) => schema::validate(entry.meta, options).map(|()| Vec::new()),
            Named::Js(rule) => schema::validate_js(rule, options),
        }
    }

    fn with_defaults(self, options: &[Json]) -> Vec<Json> {
        match self {
            Named::Native(entry) => schema::with_defaults(entry.meta, options),
            Named::Js(rule) => schema::with_js_defaults(rule, options),
        }
    }
}

/// What the configuration has for a rule.
#[derive(Copy, Clone)]
enum Existing<'c> {
    Native(&'c ConfiguredRule),
    Js(&'c ConfiguredJsRule),
}

impl<'c> Existing<'c> {
    fn severity(self) -> Severity {
        match self {
            Existing::Native(it) => it.severity,
            Existing::Js(it) => it.severity,
        }
    }

    fn options(self) -> &'c [Json] {
        match self {
            Existing::Native(it) => &it.options,
            Existing::Js(it) => &it.options,
        }
    }
}

fn quoted(parts: &[&[u8]]) -> Vec<u8> {
    parts.concat()
}

fn is_same_rule(a: &RuleEntry, b: &RuleEntry) -> bool {
    a.meta.plugin == b.meta.plugin && a.meta.name == b.meta.name
}

/// The opposite of ESLint's `containsDifferentProperty`: equal, whatever the order of the keys.
fn is_same_json(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Array(a), Json::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| is_same_json(a, b))
        }
        (Json::Object(a), Json::Object(_)) => {
            a.len() == b.as_object().map_or(0, <[_]>::len)
                && a.iter()
                    .all(|(key, a)| b.get(key).is_some_and(|b| is_same_json(a, b)))
        }
        _ => a == b,
    }
}

impl Linter {
    pub fn new(registry: Registry) -> Linter {
        Linter { registry }
    }

    pub fn registry(&self) -> &Registry {
        &self.registry
    }

    /// ESLint's `Linter.verify`, from after the file is parsed. `file` was made with
    /// `config.language`.
    pub fn lint<'a>(
        &self,
        file: &'a File<'a>,
        config: &ResolvedConfig,
        options: &LintOptions,
    ) -> LintResult {
        let locator = Locator::new(file);
        if let Some(fatal) = parse_error(file) {
            if file.language().is_oxlint && syntax::is_flow(file) {
                return LintResult::default();
            }
            return LintResult {
                messages: vec![fatal],
                ..LintResult::default()
            };
        }
        let mut result = LintResult::default();
        let mut problems: Vec<LintMessage> = Vec::new();
        let mut running: Vec<Running> = Vec::with_capacity(config.rules.len());
        for rule in &config.rules {
            if let Some(instance) = rule.instance() {
                running.push(Running {
                    entry: rule.entry,
                    reported_as: rule.reported_as(),
                    severity: rule.severity,
                    rule: RuleRef::Shared(instance),
                    refusal: rule.refusal().map(Cow::Borrowed),
                });
            }
        }
        let enabled_js = (config.js_rules.iter()).filter(|it| it.severity != Severity::Off);
        let mut running_js: Vec<RunningJs> = enabled_js
            .map(|it| RunningJs {
                severity: it.severity,
                configured: Cow::Borrowed(&it.configured),
            })
            .collect();

        // oxlint takes all but `eslint-disable` and the like for ordinary comments: `/* eslint eqeqeq: 0 */`, `/* global a */`,
        // `/* eslint-env node */`.
        let configures_in_comments = !config.understands_oxlint_comments;
        if !options.allow_inline_config || config.linter.no_inline_config || !configures_in_comments
        {
            file.ignore_config_comments();
        }
        let comments = match options.allow_inline_config {
            true => file.config_comments(),
            false => &[],
        };
        // ESLint takes `oxlint-disable` and the like for ordinary comments.
        let is_understood = |it: &&ConfigComment| {
            let is_of_oxlint =
                it.is_only_of_oxlint || file.slice(it.label_span).starts_with(b"oxlint");
            match config.understands_oxlint_comments {
                true => is_of_oxlint || options.respects_eslint_comments,
                false => !is_of_oxlint,
            }
        };
        let (mut parents, mut disable_directives) = (Vec::new(), Vec::new());
        if config.linter.no_inline_config {
            for comment in comments.iter().filter(is_understood) {
                let message = quoted(&[
                    b"'",
                    file.slice(comment.span),
                    b"' has no effect because you have 'noInlineConfig' setting in your config.",
                ]);
                problems.push(locator.problem(comment.span, Severity::Warn, None, message));
            }
        } else if !comments.is_empty() && configures_in_comments {
            let mut inline = Inline {
                linter: self,
                file,
                config,
                locator: &locator,
                problems: &mut problems,
                skipped: &mut result.skipped_rules,
                configured: Vec::new(),
            };
            for comment in comments.iter().filter(is_understood) {
                inline.apply(comment, &mut running, &mut running_js);
            }
            for comment in comments.iter().filter(is_understood) {
                inline.disable_directives(comment, &mut parents, &mut disable_directives);
            }
        }

        // ESLint's `markExportedVariables`.
        for name in file.exported_in_comments() {
            if let Some(symbol) = file.scope().get_bytes(name) {
                symbol.mark_exported();
            }
        }

        let mut rules_to_ignore = Vec::new();
        if let Some(filter) = options.rule_filter {
            running.retain(|it| {
                let id = RuleId::Known(it.reported_as);
                let runs = it.severity == Severity::Off || filter(&id, it.severity);
                if !runs {
                    rules_to_ignore.push(id);
                }
                runs
            });
            running_js.retain(|it| {
                let id = RuleId::Js(Arc::clone(&it.configured.rule));
                let runs = filter(&id, it.severity);
                if !runs {
                    rules_to_ignore.push(id);
                }
                runs
            });
        }
        // ESLint makes the rules that run, and one of them throws.
        let mut refusals = (running.iter().filter(|it| it.severity != Severity::Off))
            .filter_map(|it| it.refusal.as_deref());
        if let Some(refusal) = refusals.next() {
            return LintResult {
                thrown: Some([refusal, b"\nOccurred while linting ", file.path()].concat()),
                ..LintResult::default()
            };
        }
        // Nor can what disables a rule that does not run for lack of types be called unused.
        if file.types.is_none() && !options.again.is_some_and(|it| it.had_types) {
            let without_types = running
                .iter()
                .filter(|it| it.severity != Severity::Off && it.entry.meta.requires_types);
            rules_to_ignore.extend(without_types.map(|it| RuleId::Known(it.entry.meta)));
        }
        if options.js_plugins.is_none() {
            let skipped = running_js.iter();
            rules_to_ignore.extend(skipped.map(|it| RuleId::Js(Arc::clone(&it.configured.rule))));
        }
        if let Some(again) = options.again {
            running.retain(|it| it.entry.meta.needs_modules);
            let is_of_another_rule = |it: &&LintMessage| {
                it.message_id.is_some()
                    && !matches!(&it.rule_id, Some(RuleId::Known(meta)) if meta.needs_modules)
            };
            let previous = (again.previous.messages.iter()).chain(&again.previous.suppressed);
            problems.extend(previous.filter(is_of_another_rule).map(|it| LintMessage {
                suppressions: Vec::new(),
                ..it.clone()
            }));
        }
        // First, for the variables that they mark as used.
        if let (Some(host), Some(settings), None) =
            (options.js_plugins, &config.js_settings, options.again)
            && !running_js.is_empty()
        {
            // What a rule that does not run would have reported cannot be told.
            running_js.retain(|it| {
                let has_asked = host.has_asked_for_types(&it.configured.rule);
                if has_asked {
                    rules_to_ignore.push(RuleId::Js(Arc::clone(&it.configured.rule)));
                }
                !has_asked
            });
            // Once more for each rule that asks for types.
            while !running_js.is_empty() {
                let enabled: Vec<&js_plugin::Configured> =
                    running_js.iter().map(|it| &**it.configured).collect();
                match host.run_on_block(
                    file,
                    settings,
                    &enabled,
                    options.wants_fixes,
                    options.physical_path_len,
                ) {
                    Ok(reports) => {
                        problems.reserve(reports.len());
                        for report in reports {
                            if let Some(rule) = running_js.get(report.rule as usize) {
                                problems.push(js_message(report, rule));
                            }
                        }
                    }
                    Err(failure) => {
                        let asks = |it: &RunningJs| {
                            host.asks_for_types(&it.configured.rule, &failure.message)
                        };
                        let at = failure.rule.map(|it| it as usize);
                        if let Some(at) = at.filter(|it| running_js.get(*it).is_some_and(asks)) {
                            let taken = running_js.remove(at);
                            rules_to_ignore.push(RuleId::Js(Arc::clone(&taken.configured.rule)));
                            continue;
                        }
                        let rule = at.and_then(|it| running_js.get(it));
                        match js_failure(&failure, rule, file.path(), config) {
                            Ok(problem) => problems.push(problem),
                            Err(thrown) => {
                                return LintResult {
                                    thrown: Some(thrown),
                                    ..LintResult::default()
                                };
                            }
                        }
                    }
                }
                break;
            }
        }
        let enabled: Vec<Enabled> = (running.iter())
            .map(|it| Enabled {
                rule: match &it.rule {
                    RuleRef::Shared(rule) => *rule,
                    RuleRef::Own(rule) => &**rule,
                },
                severity: it.severity,
            })
            .collect();
        let diagnostics = crate::runner::run(file, &enabled, options.wants_fixes);
        problems.reserve(diagnostics.len());
        // What becomes of what the last rule and `messageId` change that change something.
        let mut changes = (None, config::OxlintChanges::default());
        for diagnostic in diagnostics {
            let Some(rule) = running.get(diagnostic.rule as usize) else {
                continue;
            };
            let changes_something = diagnostic.fix.is_some() || !diagnostic.suggestions.is_empty();
            let follows_oxlint = changes_something && file.language().is_oxlint;
            let key = Some((diagnostic.rule, diagnostic.message_id));
            if follows_oxlint && changes.0 != key {
                changes = (
                    key,
                    config::oxlint_changes(rule.reported_as, diagnostic.message_id),
                );
            }
            let mut message = to_message(diagnostic, rule.reported_as, &locator);
            if follows_oxlint {
                change_as_oxlint(&mut message, changes.1);
            }
            problems.push(message);
        }
        crate::utils::sort::sort_by_key(&mut problems, |it| (it.line, it.column));

        // Of a rule that has reported as much as it can, the rest is missing. So it cannot be told whether a comment that
        // disables it does nothing, and no comment of the file is removed: one that is in use would be damage to the source.
        let cut: Vec<RuleId> = (problems.iter().filter(|it| is_closing(it)))
            .filter_map(|it| it.rule_id.clone())
            .collect();
        rules_to_ignore.extend(cut.iter().cloned());
        let fixes_comments = options.wants_fixes && cut.is_empty();

        let report_unused = (options.report_unused_disable_directives)
            .unwrap_or(config.linter.report_unused_disable_directives);
        let understands_oxlint_comments =
            config.understands_oxlint_comments && !config.linter.no_inline_config;
        let is_directive = |it: &&ConfigComment| {
            matches!(
                it.label,
                Label::Disable | Label::Enable | Label::DisableLine | Label::DisableNextLine
            )
        };
        let has_directives = match understands_oxlint_comments {
            true => comments.iter().any(|it| is_directive(&it)),
            false => !disable_directives.is_empty(),
        };
        let can_tell = |name: &[u8]| {
            let slash = bun_core::strings::last_index_of_char(name, b'/');
            match config.find_js_rule(name) {
                Some(_) => true,
                None if config.find_rule(&self.registry, name).is_some() => true,
                // One of a plugin that is skipped.
                None if slash.is_some() && config.has_skipped_rules => false,
                None => !config::is_rule_of_oxlint(slash.map_or(name, |it| &name[it + 1..])),
            }
        };
        // Adds to each of `messages`, which are sorted by position, what suppresses it.
        let apply_comments =
            |report_unused, wants_fixes, wants_suppressions, messages: &mut Vec<LintMessage>| {
                if understands_oxlint_comments {
                    disable_oxlint::apply(
                        &disable_oxlint::Input {
                            file,
                            report_unused,
                            wants_fixes,
                            rules_to_ignore: &rules_to_ignore,
                            has_skipped_rules: config.has_skipped_rules,
                            can_tell: &can_tell,
                        },
                        comments.iter().filter(is_directive).filter(is_understood),
                        messages,
                    );
                    crate::utils::sort::sort_by_key(messages, |it| (it.line, it.column));
                } else {
                    disable::apply_disable_directives(
                        &disable::Input {
                            file,
                            parents: &parents,
                            directives: &disable_directives,
                            report_unused,
                            wants_fixes,
                            wants_suppressions,
                            rules_to_ignore: &rules_to_ignore,
                            has_skipped_rules: config.has_skipped_rules,
                        },
                        messages,
                    );
                }
            };
        apply_comments(
            report_unused,
            fixes_comments,
            options.wants_suppressions,
            &mut problems,
        );

        // What is missing of a rule is not known. The reports that are kept can all be in a part of the file in which the rule is
        // disabled, and the missing ones after the `eslint-enable`. So a message of the rule is tried wherever there is code.
        let mut off_everywhere = if has_directives {
            cut.clone()
        } else {
            Vec::new()
        };
        // Only then: to ask for the tokens of a file splits it into tokens.
        let mut places = (!off_everywhere.is_empty())
            .then(|| places_to_probe(file))
            .into_iter()
            .flatten();
        while !off_everywhere.is_empty() {
            let places = places
                .by_ref()
                .take(PROBES_AT_A_TIME)
                .map(|it| (locator.position(it.start), locator.position(it.end)));
            let mut probes: Vec<LintMessage> = places
                .flat_map(|at| off_everywhere.iter().map(move |rule| probe(rule, at)))
                .collect();
            if probes.is_empty() {
                break;
            }
            apply_comments(Severity::Off, false, false, &mut probes);
            off_everywhere.retain(|rule| {
                let mut of_rule = probes.iter().filter(|it| it.rule_id.as_ref() == Some(rule));
                of_rule.all(|it| !it.suppressions.is_empty())
            });
        }
        for rule in &cut {
            suppress_closing_like_the_rest(&mut problems, rule, off_everywhere.contains(rule));
        }
        if !has_directives {
            result.messages = problems;
        } else {
            let (suppressed, messages) = problems
                .into_iter()
                .partition(|it| !it.suppressions.is_empty());
            result.messages = messages;
            result.suppressed = suppressed;
        }
        result
    }
}

/// Whether it says that a rule has reported as much as it can in the file: see [`Cx::report`](crate::context::Cx::report).
fn is_closing(message: &LintMessage) -> bool {
    matches!(message.rule_id, Some(RuleId::Known(_)))
        && matches!(
            message.message_id.as_deref(),
            Some("tooManyProblems" | "tooLargeProblems")
        )
}

/// How many places are tried in one go whether comments switch a rule off there.
const PROBES_AT_A_TIME: usize = 1 << 16;

/// The tokens at which what the comments do with a message can be something else than at the token before: the first of a line,
/// and one after a comment.
fn places_to_probe<'a>(file: &'a File<'a>) -> impl Iterator<Item = Span> + 'a {
    let mut end_of_the_last = None;
    file.tokens().filter_map(move |token| {
        let span = token.span();
        let is_next_to_the_last = end_of_the_last.replace(span.end).is_some_and(|end| {
            file.slice(Span::before(end, span))
                .iter()
                .all(|it| matches!(it, b' ' | b'\t'))
        });
        (!is_next_to_the_last).then_some(span)
    })
}

/// A message of `rule` from a line and a column to another, for the comments to suppress or not. It is not reported.
///
/// It has an end: for oxlint a comment is about what overlaps its range, which nothing without a length does at the start of it.
fn probe(rule: &RuleId, ((line, column), end): ((u32, u32), (u32, u32))) -> LintMessage {
    LintMessage {
        rule_id: Some(rule.clone()),
        line,
        column,
        end: Some(end),
        ..LintMessage::default()
    }
}

/// That reports of `rule` are missing is not shown if and only if none of those that are kept is shown and comments switch the rule
/// off wherever there is code. Which comment happens to be where the first missing report would be does not count.
fn suppress_closing_like_the_rest(
    problems: &mut [LintMessage],
    rule: &RuleId,
    is_off_everywhere: bool,
) {
    let mut kept = problems
        .iter()
        .filter(|it| it.rule_id.as_ref() == Some(rule) && !is_closing(it));
    let suppressions = match is_off_everywhere && kept.clone().all(|it| !it.suppressions.is_empty())
    {
        true => kept
            .next_back()
            .map(|it| it.suppressions.clone())
            .unwrap_or_default(),
        false => Vec::new(),
    };
    for closing in problems
        .iter_mut()
        .filter(|it| it.rule_id.as_ref() == Some(rule) && is_closing(it))
    {
        closing.suppressions.clone_from(&suppressions);
    }
}

/// A fix that becomes a suggestion says what the report says.
fn change_as_oxlint(message: &mut LintMessage, changes: config::OxlintChanges) {
    if changes.are_dropped {
        message.fix = None;
        message.suggestions.clear();
        return;
    }
    if let Some(kind) = changes.suggestions {
        for suggestion in &mut message.suggestions {
            suggestion.kind = kind;
        }
    }
    if let Some(kind) = changes.fix
        && let Some(fix) = message.fix.take()
    {
        let suggestion = Suggestion {
            message_id: Cow::Borrowed(""),
            message: message.message.clone(),
            data: Vec::new(),
            fix,
            kind,
        };
        message.suggestions.insert(0, suggestion);
    }
}

fn to_message(diagnostic: Diagnostic, rule: &'static Meta, locator: &Locator) -> LintMessage {
    let (line, column) = match diagnostic.start_position {
        Some(start) => (start.line, start.column.wrapping_add(1)),
        None => locator.position(diagnostic.span.start),
    };
    LintMessage {
        rule_id: Some(RuleId::Known(rule)),
        severity: diagnostic.severity,
        message: diagnostic.message,
        message_id: Some(Cow::Borrowed(diagnostic.message_id)),
        line,
        column,
        end: (!diagnostic.has_no_end).then(|| match diagnostic.end_position {
            // A column of -1, which ESLint has, is `u32::MAX`.
            Some(end) => (end.line, end.column.wrapping_add(1)),
            None => locator.position(diagnostic.span.end),
        }),
        is_fatal: false,
        fix: diagnostic.fix,
        suggestions: (diagnostic.suggestions.into_iter().map(Into::into)).collect(),
        suppressions: Vec::new(),
        comments_apply_at: (diagnostic.comments_apply_at)
            .map(|it| (locator.position(it.start), locator.position(it.end))),
        details: diagnostic.details.map(|it| {
            let place = |(span, text): (Span, Cow<'static, str>)| {
                let (start, end) = (locator.position(span.start), locator.position(span.end));
                (start, end, text)
            };
            Box::new(Details {
                first_label: it.first_label,
                labels: it.labels.into_iter().map(place).collect(),
                help: it.help,
                note: it.note,
            })
        }),
    }
}

fn js_message(report: js_plugin::Report, rule: &RunningJs) -> LintMessage {
    let id = report.message_id;
    LintMessage {
        rule_id: Some(RuleId::Js(Arc::clone(&rule.configured.rule))),
        severity: rule.severity,
        message: report.message,
        message_id: Some(id.map_or(Cow::Borrowed(""), |id| Cow::Owned(id.into()))),
        line: report.line,
        column: report.column,
        end: report.end,
        is_fatal: false,
        fix: report.fix,
        suggestions: (report.suggestions.into_iter().map(Into::into)).collect(),
        suppressions: Vec::new(),
        comments_apply_at: None,
        details: None,
    }
}

/// What becomes of a rule of a JavaScript plugin that throws. `Err`: ESLint throws it on. oxlint reports it for the file.
fn js_failure(
    failure: &js_plugin::Failure,
    rule: Option<&RunningJs>,
    path: &[u8],
    config: &ResolvedConfig,
) -> Result<LintMessage, Vec<u8>> {
    let message = &failure.message[..];
    if !config.prefers_typescript_rules {
        let mut thrown = [message, b"\nOccurred while linting ", path].concat();
        if let Some(line) = failure.line {
            thrown.extend_from_slice(format!(":{line}").as_bytes());
        }
        if let Some(rule) = rule {
            thrown.extend_from_slice(b"\nRule: \"");
            thrown.extend_from_slice(&rule.configured.rule.id);
            thrown.push(b'"');
        }
        return Err(thrown);
    }
    Ok(LintMessage {
        rule_id: None,
        severity: Severity::Error,
        message: [
            b"Error running JS plugin.\nFile path: ",
            path,
            b"\n",
            message,
        ]
        .concat(),
        message_id: None,
        line: 0,
        column: 0,
        end: None,
        is_fatal: true,
        fix: None,
        suggestions: Vec::new(),
        suppressions: Vec::new(),
        comments_apply_at: None,
        details: None,
    })
}

/// Applies the comments of a file to its configuration.
struct Inline<'i, 'c, 'a> {
    linter: &'i Linter,
    file: &'a File<'a>,
    config: &'c ResolvedConfig,
    locator: &'i Locator<'a>,
    problems: &'i mut Vec<LintMessage>,
    skipped: &'i mut Vec<Box<[u8]>>,
    /// The rules that a comment has configured already.
    configured: Vec<Named<'c>>,
}

impl<'c, 'a> Inline<'_, 'c, 'a> {
    fn error(&mut self, comment: &ConfigComment, rule_id: Option<RuleId>, message: Vec<u8>) {
        self.problems.push(
            self.locator
                .problem(comment.span, Severity::Error, rule_id, message),
        );
    }

    fn fatal(&mut self, comment: &ConfigComment, message: Vec<u8>) {
        let mut problem = self
            .locator
            .problem(comment.span, Severity::Error, None, message);
        problem.is_fatal = true;
        self.problems.push(problem);
    }

    /// The rule called `id`. If there is none, reports that, unless the plugin is one that the
    /// configuration knows.
    fn find(&mut self, comment: &ConfigComment, id: &[u8]) -> Option<Named<'c>> {
        let config = self.config;
        let js = config.find_js_rule(id);
        let native = || (config.find_rule(&self.linter.registry, id)).map(Named::Native);
        let found = match js {
            // What `jsPlugins` names hides a plugin of the same name that is implemented here.
            Some(js) if config.skips_unknown_rules => js.map(Named::Js),
            Some(js) => native().or_else(|| js.map(Named::Js)),
            None => native(),
        };
        if found.is_none() {
            // All rules of a plugin that is loaded are known.
            let is_known_to_be_missing = js.is_some() && !config.skips_unknown_rules;
            if !is_known_to_be_missing && self.config.is_foreign(id) {
                if !self.skipped.iter().any(|it| **it == *id) {
                    self.skipped.push(id.into());
                }
            } else {
                let message = registry::missing_rule_message(id);
                self.error(comment, Some(RuleId::Unknown(id.into())), message);
            }
        }
        found
    }

    /// The part of ESLint's `applyInlineConfig` and of what `verify` does with its result that is
    /// about rules.
    fn apply(
        &mut self,
        comment: &ConfigComment,
        running: &mut Vec<Running<'c>>,
        running_js: &mut Vec<RunningJs<'c>>,
    ) {
        match comment.label {
            Label::Rules => {}
            Label::Env if self.file.language().reads_env_comments => return,
            Label::Env => {
                return self.fatal(
                    comment,
                    b"/* eslint-env */ comments are no longer supported.".to_vec(),
                );
            }
            Label::Global => {
                for (_, value) in comment::parse_string_config(self.file.slice(comment.value)) {
                    if let Some(value) = value
                        && crate::language::Global::of(&value).is_none()
                    {
                        let message = quoted(&[
                            b"'",
                            &value,
                            b"' is not a valid configuration for a global (use 'readonly', 'writable', or 'off')",
                        ]);
                        self.fatal(comment, message);
                    }
                }
                return;
            }
            _ => return,
        }
        let rules = match comment::parse_json_like_config(self.file.slice(comment.value)) {
            Ok(rules) => rules,
            Err(message) => return self.fatal(comment, message),
        };
        for (id, value) in rules {
            let Some(rule) = self.find(comment, &id) else {
                continue;
            };
            if self.configured.iter().any(|it| it.is(rule)) {
                let message = quoted(&[
                    b"Rule \"",
                    &id,
                    b"\" is already configured by another configuration comment in the preceding code. This configuration is ignored.",
                ]);
                self.error(comment, None, message);
                continue;
            }
            let inline: &[Json] = match &value {
                Json::Array(items) => items,
                value => std::slice::from_ref(value),
            };
            let Some(severity) = inline.first().and_then(severity_of) else {
                // The message of `InvalidRuleSeverityError`, from after its first colon.
                let full = quoted(&[
                    b"Key \"",
                    &id,
                    b"\": Expected severity of \"off\", 0, \"warn\", 1, \"error\", or 2.",
                ]);
                let colon = bun_core::strings::index_of_char_usize(&full, b':').unwrap_or(0);
                let mut passed = Vec::new();
                message::write_js_string(&mut passed, &value);
                let message = quoted(&[
                    b"Inline configuration for rule \"",
                    &id,
                    b"\" is invalid:\n\t",
                    space::trim(&full[colon + 1..]),
                    b" You passed \"",
                    &passed,
                    b"\".\n",
                ]);
                self.error(comment, Some(rule.id()), message);
                continue;
            };
            let existing = match rule {
                Named::Native(entry) => self.config.rule(entry).map(Existing::Native),
                Named::Js(rule) => self.config.js_rule(rule).map(Existing::Js),
            };
            // A comment that has only a severity keeps the options of the configuration.
            let options: &[Json] = match (inline.len(), existing) {
                (1, Some(existing)) => existing.options(),
                _ => &inline[1..],
            };
            if self.config.linter.report_unused_inline_configs != Severity::Off {
                self.report_if_unused(
                    comment,
                    &id,
                    rule,
                    existing,
                    severity,
                    options,
                    inline.len() == 1,
                );
            }
            // The options of a rule that the configuration enables are validated already.
            let is_validated =
                inline.len() == 1 && existing.is_some_and(|it| it.severity() != Severity::Off);
            // ESLint leaves out what is off only if that is written `0`.
            let is_zero = matches!(inline.first(), Some(Json::Number(n)) if *n == 0.0);
            let validated = match is_validated || is_zero {
                true => None,
                false => Some(rule.validate(options)),
            };
            if let Some(Err(lines)) = &validated {
                let message = quoted(&[
                    b"Inline configuration for rule \"",
                    &id,
                    b"\" is invalid:\n\t",
                    space::trim(lines),
                    b"\n",
                ]);
                self.error(comment, Some(rule.id()), message);
                continue;
            }
            self.configured.push(rule);
            let (entry, existing) = match (rule, existing) {
                (Named::Native(entry), Some(Existing::Native(existing))) => (entry, Some(existing)),
                (Named::Native(entry), _) => (entry, None),
                (Named::Js(js), existing) => {
                    let is_it = |it: &RunningJs| Arc::ptr_eq(&it.configured.rule, js);
                    if severity == Severity::Off {
                        running_js.retain(|it| !is_it(it));
                        continue;
                    }
                    let new = RunningJs {
                        severity,
                        configured: match existing {
                            Some(Existing::Js(it)) if inline.len() == 1 => {
                                Cow::Borrowed(&it.configured)
                            }
                            _ => Cow::Owned(js_plugin::Configured::new(
                                Arc::clone(js),
                                &match validated {
                                    Some(Ok(options)) => options,
                                    _ => rule.with_defaults(options),
                                },
                            )),
                        },
                    };
                    match running_js.iter_mut().find(|it| is_it(it)) {
                        Some(running) => *running = new,
                        None => running_js.push(new),
                    }
                    continue;
                }
            };
            let shared = existing
                .filter(|_| inline.len() == 1)
                .and_then(ConfiguredRule::instance);
            let refusal = match shared {
                Some(_) => existing
                    .and_then(ConfiguredRule::refusal)
                    .map(Cow::Borrowed),
                None if severity == Severity::Off => None,
                None => (entry.validate)(&Options::new(options))
                    .err()
                    .map(Cow::Owned),
            };
            let rule = match shared {
                Some(rule) => RuleRef::Shared(rule),
                None if severity == Severity::Off => {
                    running.retain(|it| !is_same_rule(it.entry, entry));
                    continue;
                }
                None => RuleRef::Own((entry.build)(&Options::new(options))),
            };
            let new = Running {
                entry,
                reported_as: existing.map_or(entry.meta, ConfiguredRule::reported_as),
                severity,
                rule,
                refusal,
            };
            match running.iter_mut().find(|it| is_same_rule(it.entry, entry)) {
                Some(running) => *running = new,
                None => running.push(new),
            }
        }
    }

    /// ESLint's `addProblemIfSameSeverityAndOptions`.
    fn report_if_unused(
        &mut self,
        comment: &ConfigComment,
        id: &[u8],
        rule: Named,
        existing: Option<Existing>,
        severity: Severity,
        options: &[Json],
        has_only_severity: bool,
    ) {
        if existing.map_or(Severity::Off, Existing::severity) != severity {
            return;
        }
        let name = match severity {
            Severity::Off => "off",
            Severity::Warn => "warn",
            Severity::Error => "error",
        };
        let already = match existing {
            Some(_) => format!("is already configured to '{name}'"),
            None => "is not enabled so can't be turned off".to_owned(),
        };
        let existing_options = existing.map_or(Vec::new(), |it| rule.with_defaults(it.options()));
        let options = rule.with_defaults(options);
        let suffix: &[u8] =
            if existing_options.is_empty() && options.is_empty() || severity == Severity::Off {
                b")."
            } else if options.len() == existing_options.len()
                && options
                    .iter()
                    .zip(&existing_options)
                    .all(|(a, b)| is_same_json(a, b))
            {
                if has_only_severity {
                    b")."
                } else {
                    b" with the same options)."
                }
            } else {
                return;
            };
        let message = quoted(&[
            b"Unused inline config ('",
            id,
            b"' ",
            already.as_bytes(),
            suffix,
        ]);
        let severity = self.config.linter.report_unused_inline_configs;
        self.problems
            .push(self.locator.problem(comment.span, severity, None, message));
    }

    /// ESLint's `getDisableDirectives` and `createDisableDirectives`.
    fn disable_directives(
        &mut self,
        comment: &ConfigComment,
        parents: &mut Vec<disable::Parent<'a>>,
        directives: &mut Vec<disable::Directive<'a>>,
    ) {
        let kind = match comment.label {
            Label::Disable => disable::Kind::Disable,
            Label::Enable => disable::Kind::Enable,
            Label::DisableLine => disable::Kind::DisableLine,
            Label::DisableNextLine => disable::Kind::DisableNextLine,
            _ => return,
        };
        let (start, end) = (
            self.locator.position(comment.span.start),
            self.locator.position(comment.span.end),
        );
        if kind == disable::Kind::DisableLine && start.0 != end.0 {
            let message = quoted(&[
                self.file.slice(comment.label_span),
                b" comment should not span multiple lines.",
            ]);
            return self.error(comment, None, message);
        }
        let list = self.file.slice(comment.value);
        let mut names = comment::parse_list_config(list);
        let (line, column) = if kind == disable::Kind::DisableNextLine {
            end
        } else {
            start
        };
        let parent = parents.len() as u32;
        let mut push = |rule: Option<RuleId>, name: &'a [u8]| {
            directives.push(disable::Directive {
                kind,
                line,
                column,
                rule,
                name,
                parent,
            });
        };
        if names.is_empty() {
            push(None, b"");
        }
        // Two names for one rule count once.
        let mut rules: Vec<Named> = Vec::new();
        names.retain(|&name| {
            let Some(rule) = self.find(comment, name) else {
                return true;
            };
            let is_new = !rules.iter().any(|it| it.is(rule));
            if is_new {
                rules.push(rule);
                push(Some(rule.id()), name);
            }
            is_new
        });
        parents.push(disable::Parent {
            comment: comment.span,
            list,
            names,
            justification: self.file.slice(comment.justification),
            start,
        });
    }
}

/// All threads share these.
const _: fn() = || {
    fn is_shared<T: Send + Sync>() {}
    is_shared::<Linter>();
    is_shared::<Config>();
    is_shared::<ResolvedConfig>();
};
