//! What ESLint's `Linter` does around the rules: the configuration of a file, the comments that
//! change it (`eslint-disable`, `global`, `exported`, `eslint rule: ..`), and the globals.
//!
//! - [`Registry`]: the rules that exist.
//! - [`Config`]: the configuration of a run.
//! - [`ResolvedConfig`]: what is configured for one file.
//! - [`Linter::lint`]: ESLint's `Linter.verify` for a file that is parsed already.
//! - [`LintMessage`]: what it reports.
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
//! if !resolved.is_supported(path) { continue }
//! let how = resolved.language.parse_options(path); // The arguments of `summarize`.
//! let file = File::new(path, &hir, &bound, &atoms, &resolved.language, types);
//! let result = linter.lint(&file, &resolved, &LintOptions::default());
//! ```

mod comment;
pub mod config;
mod directives;
mod disable;
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

pub use config::{Config, ConfigError, FileConfig, Glob, RcFlavor};
pub use fixer::{FixReport, Fixed, MAX_AUTOFIX_PASSES, apply_fixes, verify_and_fix};
pub use globals::{CommentGlobal, GlobalVariable};
pub use levn::parse_object as parse_levn_object;
pub use message::{LintMessage, RuleId, Suppression, Utf16Offsets, write_json, write_json_string};
pub(crate) use per_file::PerFile;
pub use registry::{Registry, parse_rule_id};
pub use resolved::{ConfiguredRule, LinterOptions, ResolvedConfig, severity_of};
pub(crate) use space::trim as trim_js_space;

use crate::ast::File;
use crate::context::{Diagnostic, Severity};
use crate::language::{Parser, SourceType};
use crate::options::{Json, Options};
use crate::runner::{AnyRule, Enabled, RuleEntry};
use bun_sema::hir::DiagnosticKind;
use directives::{ConfigComment, Label};
use message::Locator;

/// What a test of this module can reach of its parts.
#[doc(hidden)]
pub mod testing {
    pub use super::comment::{
        parse_directive, parse_json_like_config, parse_list_config, parse_string_config,
    };
    pub use super::directives::candidates;
    pub use super::json_v8::parse as json_parse;
    pub use super::message::write_json;
    pub use super::schema::validate_by_id;
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
    /// ESLint's `ruleFilter`: which of the enabled rules run. `--quiet` leaves out those that warn.
    pub rule_filter: Option<&'o (dyn Fn(&RuleId, Severity) -> bool + Sync)>,
}

impl Default for LintOptions<'_> {
    fn default() -> Self {
        LintOptions {
            allow_inline_config: true,
            report_unused_disable_directives: None,
            wants_fixes: true,
            rule_filter: None,
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
}

pub struct Linter {
    registry: Registry,
}

/// A rule as it runs on the file: as it is configured, or as a comment changes that.
struct Running<'r> {
    entry: &'static RuleEntry,
    severity: Severity,
    rule: RuleRef<'r>,
}

enum RuleRef<'r> {
    Shared(&'r dyn AnyRule),
    /// Made for this file, from the options in a comment.
    Own(Box<dyn AnyRule>),
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
        if let Some(fatal) = parse_error(file, &locator) {
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
                    severity: rule.severity,
                    rule: RuleRef::Shared(instance),
                });
            }
        }

        if !options.allow_inline_config || config.linter.no_inline_config {
            file.ignore_config_comments();
        }
        let comments = match options.allow_inline_config {
            true => file.config_comments(),
            false => &[],
        };
        let (mut parents, mut disable_directives) = (Vec::new(), Vec::new());
        if config.linter.no_inline_config {
            for comment in comments {
                let message = quoted(&[
                    b"'",
                    file.slice(comment.span),
                    b"' has no effect because you have 'noInlineConfig' setting in your config.",
                ]);
                problems.push(locator.problem(comment.span, Severity::Warn, None, message));
            }
        } else if !comments.is_empty() {
            let mut inline = Inline {
                linter: self,
                file,
                config,
                locator: &locator,
                problems: &mut problems,
                skipped: &mut result.skipped_rules,
                configured: Vec::new(),
            };
            for comment in comments {
                inline.apply(comment, &mut running);
            }
            for comment in comments {
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
                let id = RuleId::Known(it.entry.meta);
                let runs = it.severity == Severity::Off || filter(&id, it.severity);
                if !runs {
                    rules_to_ignore.push(id);
                }
                runs
            });
        }
        // Nor can what disables a rule that does not run for lack of types be called unused.
        if file.types.is_none() {
            let without_types = running
                .iter()
                .filter(|it| it.severity != Severity::Off && it.entry.meta.requires_types);
            rules_to_ignore.extend(without_types.map(|it| RuleId::Known(it.entry.meta)));
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
        for diagnostic in diagnostics {
            let Some(rule) = running.get(diagnostic.rule as usize) else {
                continue;
            };
            problems.push(to_message(diagnostic, rule.entry, &locator));
        }
        problems.sort_by_key(|it| (it.line, it.column));

        disable::apply_disable_directives(
            &disable::Input {
                file,
                parents: &parents,
                directives: &disable_directives,
                report_unused: (options.report_unused_disable_directives)
                    .unwrap_or(config.linter.report_unused_disable_directives),
                wants_fixes: options.wants_fixes,
                rules_to_ignore: &rules_to_ignore,
            },
            &mut problems,
        );
        if disable_directives.is_empty() {
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

fn to_message(diagnostic: Diagnostic, entry: &'static RuleEntry, locator: &Locator) -> LintMessage {
    let (line, column) = locator.position(diagnostic.span.start);
    LintMessage {
        rule_id: Some(RuleId::Known(entry.meta)),
        severity: diagnostic.severity,
        message: diagnostic.message,
        message_id: Some(diagnostic.message_id),
        line,
        column,
        end: (!diagnostic.has_no_end).then(|| match diagnostic.end_position {
            // A column of -1, which ESLint has, is `u32::MAX`.
            Some(end) => (end.line, end.column.wrapping_add(1)),
            None => locator.position(diagnostic.span.end),
        }),
        is_fatal: false,
        fix: diagnostic.fix,
        suggestions: diagnostic.suggestions,
        suppressions: Vec::new(),
    }
}

/// The message for a file that cannot be parsed: the first error of the parser, as
/// typescript-estree reports it.
fn parse_error(file: &File, locator: &Locator) -> Option<LintMessage> {
    if !file.has_parse_errors() {
        return None;
    }
    let language = file.language();
    // What is an error in strict mode only. TypeScript's parser always reports it.
    let is_sloppy = language.parser == Parser::Espree
        && language.source_type != SourceType::Module
        && !language.implied_strict;
    let is_tolerated = |code: u32| match code {
        // Octal literals and escapes, `\8`, `08`.
        1121 | 1487 | 1488 | 1489 => is_sloppy,
        // `import a from "a" assert { .. }`, which typescript-estree accepts.
        2880 => true,
        _ => false,
    };
    let parse_errors = || {
        file.hir
            .diagnostics
            .iter()
            .filter(|it| it.kind == DiagnosticKind::Parse)
    };
    if parse_errors().next().is_some() && parse_errors().all(|it| is_tolerated(it.code)) {
        return None;
    }
    let first = parse_errors()
        .find(|it| !is_tolerated(it.code))
        .or_else(|| file.hir.diagnostics.first());
    let mut message = b"Parsing error: ".to_vec();
    match first.and_then(|it| Some((it, bun_sema::messages::message(it.code)?.1))) {
        Some((diagnostic, text)) => {
            bun_sema::messages::format(&mut message, text, &diagnostic.args)
        }
        None => message.extend_from_slice(b"Unexpected token"),
    }
    let (line, column) = locator.position(first.map_or(0, |it| it.start));
    // typescript-estree counts the column of an error from 0, espree from 1.
    let from_zero = language.parser == Parser::TypeScript;
    Some(LintMessage {
        rule_id: None,
        severity: Severity::Error,
        message,
        message_id: None,
        line,
        column: column - u32::from(from_zero),
        end: None,
        is_fatal: true,
        fix: None,
        suggestions: Vec::new(),
        suppressions: Vec::new(),
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
    configured: Vec<&'static RuleEntry>,
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
    fn find(&mut self, comment: &ConfigComment, id: &[u8]) -> Option<&'static RuleEntry> {
        let found = self.config.find_rule(&self.linter.registry, id);
        if found.is_none() {
            if self.config.is_foreign(id) {
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
    fn apply(&mut self, comment: &ConfigComment, running: &mut Vec<Running<'c>>) {
        match comment.label {
            Label::Rules => {}
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
            let Some(entry) = self.find(comment, &id) else {
                continue;
            };
            if self.configured.iter().any(|it| is_same_rule(it, entry)) {
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
                self.error(comment, Some(RuleId::Known(entry.meta)), message);
                continue;
            };
            let existing = self.config.rule(entry);
            // A comment that has only a severity keeps the options of the configuration.
            let options: &[Json] = match (inline.len(), existing) {
                (1, Some(existing)) => &existing.options,
                _ => &inline[1..],
            };
            if self.config.linter.report_unused_inline_configs != Severity::Off {
                self.report_if_unused(
                    comment,
                    &id,
                    entry,
                    existing,
                    severity,
                    options,
                    inline.len() == 1,
                );
            }
            // The options of a rule that the configuration enables are validated already.
            let is_validated =
                inline.len() == 1 && existing.is_some_and(|it| it.severity != Severity::Off);
            // ESLint leaves out what is off only if that is written `0`.
            let is_zero = matches!(inline.first(), Some(Json::Number(n)) if *n == 0.0);
            if !is_validated
                && !is_zero
                && let Err(lines) = schema::validate(entry.meta, options)
            {
                let message = quoted(&[
                    b"Inline configuration for rule \"",
                    &id,
                    b"\" is invalid:\n\t",
                    space::trim(&lines),
                    b"\n",
                ]);
                self.error(comment, Some(RuleId::Known(entry.meta)), message);
                continue;
            }
            self.configured.push(entry);
            let shared = existing
                .filter(|_| inline.len() == 1)
                .and_then(ConfiguredRule::instance);
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
                severity,
                rule,
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
        entry: &'static RuleEntry,
        existing: Option<&ConfiguredRule>,
        severity: Severity,
        options: &[Json],
        has_only_severity: bool,
    ) {
        if existing.map_or(Severity::Off, |it| it.severity) != severity {
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
        let existing_options = existing.map_or(Vec::new(), |it| {
            schema::with_defaults(entry.meta, &it.options)
        });
        let options = schema::with_defaults(entry.meta, options);
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
        let mut rules: Vec<&'static RuleEntry> = Vec::new();
        names.retain(|&name| {
            let Some(entry) = self.find(comment, name) else {
                return true;
            };
            let is_new = !rules.iter().any(|it| is_same_rule(it, entry));
            if is_new {
                rules.push(entry);
                push(Some(RuleId::Known(entry.meta)), name);
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
