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
//! let linter = Linter::<Rules>::new(Registry::new(&[bun_lint_eslint::RULES, bun_lint_typescript::RULES]));
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
mod instances;
mod json_v8;
mod levn;
mod message;
mod per_file;
mod registry;
mod resolved;
mod schema;
mod syntax;

pub use config::{
    Config, ConfigError, FileConfig, InJavaScript, LegacyFailure, LegacyFile, LegacyKind,
    LegacyOptions, LoadLegacy, LoadLocatedPlugin, LoadPlugin, NamedPlugin, is_plugin_of_oxlint,
    oxlint_category,
};
pub use fixer::{
    FixReport, Fixed, MAX_AUTOFIX_PASSES, apply_fixes, is_parse_error, is_redeclaration,
    verify_and_fix,
};
pub use globals::{CommentGlobal, GlobalVariable};
pub use json_v8::parse as json_parse;
pub use levn::parse_object as parse_levn_object;
pub(crate) use message::write_json_with;
pub use message::{
    Data, Details, LintMessage, NotNumbers, RuleId, Suggestion, Suppression, SuppressionKind,
    Utf16Offsets, write_json, write_json_indented,
};
pub(crate) use per_file::PerFile;
pub use registry::{
    Deprecated, Missing, Modes, Names, NativePlugins, Registry, deprecated_info, deprecated_rule,
    formatting_rule, formatting_rules, normalize_plugin_name, oxlint_category_of_key,
    oxlint_filter_keys, oxlint_rule_key, parse_rule_id, plugin_of_oxlint,
};
pub use resolved::{
    ConfiguredJsRule, ConfiguredRule, Entry, FormattingRule, LinterOptions, ResolvedConfig,
    severity_of,
};
use resolved::{Prepared, Skipped, Slot};
pub use schema::{OptionMistake, Step, mistake_in_options, schema_and_defaults};
pub use syntax::{
    Refusal, TypesInJavaScript, goes_to_flow, may_be_misread, parse_error, parse_errors,
    refusal_of_oxfmt, refusal_of_prettier, refused_by_prettier_with,
};

use crate::ast::File;
use crate::context::{Diagnostic, Severity};
use crate::js_plugin;
use crate::options::{Json, Options};
use crate::oxlint_order::Ran as InOxlint;
use crate::rule::{Meta, When};
use crate::rule_set::{RuleBits, RuleSet};
use crate::runner::{Enabled, Listeners, RuleEntry, each_bit};
use crate::span::Span;
use directives::ConfigComment;
pub(crate) use directives::Label;
use instances::Instances;
use message::Locator;
use std::borrow::Cow;
use std::sync::Arc;

/// ESLint's `VerifyOptions`: what the command line says about how to lint.
#[derive(Copy, Clone)]
pub struct LintOptions<'o> {
    /// `false`: `--no-inline-config`. Comments are ignored, silently.
    pub allow_inline_config: bool,
    /// `--report-unused-disable-directives-severity`, which overrides the configuration.
    pub report_unused_disable_directives: Option<Severity>,
    /// Whether anything reads [`LintMessage::fix`] and [`LintMessage::suggestions`]. If not, the rules here make none. A rule in
    /// JavaScript is asked all the same, as by ESLint and by oxlint: what its functions do shows, and they can throw.
    pub wants_fixes: bool,
    /// ESLint's `disableFixes`: no rule is asked for a fix or a suggestion.
    pub disables_fixes: bool,
    /// Whether anything reads the texts of these. If not, they are empty: see `Sink::drops_texts_of_fixes`.
    pub wants_texts_of_fixes: bool,
    /// Whether anything reads [`LintMessage::help`].
    pub wants_help: bool,
    /// Whether anything reads [`LintMessage::message`] of what the rules here report, and [`Suggestion::message`]. If not, they are
    /// empty.
    pub wants_messages: bool,
    /// Whether anything reads where the messages are, and in which order. If not, those of the rules here have no place, unless
    /// something else needs it: a fix, or a comment of the file that disables rules.
    pub wants_places: bool,
    /// Whether anything reads what is in [`LintMessage::suppressions`]. If not, a message that comments suppress has one of
    /// them, not one for each comment that is in effect: n comments that disable and n messages make n² of them.
    pub wants_suppressions: bool,
    /// ESLint's `ruleFilter`: which of the enabled rules run. `--quiet` leaves out those that warn.
    pub rule_filter: Option<&'o (dyn Fn(&RuleId, Severity) -> bool + Sync)>,
    /// Runs the rules of JavaScript plugins. `None`: they are skipped.
    pub js_plugins: Option<&'o js_plugin::Host<'o>>,
    /// For [`Host::run_on_block`](js_plugin::Host::run_on_block).
    pub parse_again: Option<&'o js_plugin::ParseAgain<'o>>,
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
            disables_fixes: false,
            wants_texts_of_fixes: true,
            wants_help: true,
            wants_messages: true,
            wants_places: true,
            wants_suppressions: true,
            rule_filter: None,
            js_plugins: None,
            parse_again: None,
            again: None,
            physical_path_len: None,
            respects_eslint_comments: true,
        }
    }
}

/// What [`Linter::lint`] returns.
#[derive(Default, Debug)]
pub struct LintResult {
    /// Sorted by position: see [`LintOptions::wants_places`].
    pub messages: Vec<LintMessage>,
    /// ESLint's `suppressedMessages`: what `eslint-disable` comments hide.
    pub suppressed: Vec<LintMessage>,
    /// Rules that comments of the file name, and that belong to a plugin that is configured but
    /// not implemented here. They are skipped.
    pub skipped_rules: Vec<Box<[u8]>>,
    /// Why a rule has [handed the file back](File::hand_back) to that of its package, which has run in its place.
    pub handed_back: Option<crate::formats::Reason>,
    /// It [may be misread](may_be_misread), and whoever lints has somebody else to read it. There is nothing else in the result.
    pub is_unread: bool,
    /// ESLint throws this while it lints the file, and that ends the run with the exit code 2: a rule refuses options that its
    /// schema accepts ([`Rule::validate`](crate::rule::Rule::validate)), or a rule of a JavaScript plugin throws. There is
    /// nothing else in the result then.
    pub thrown: Option<Vec<u8>>,
    /// [`File::known_line_starts`], for whoever lints to keep.
    pub line_starts: Option<Vec<u32>>,
    /// With a configuration of oxlint that has a rule for which the file may be linted again: where in the run of oxlint each of
    /// the messages of the rules is, by [`LintMessage::reported`], from 1.
    pub run_keys: Vec<(u64, u128)>,
}

/// `S`: the rules that it has.
pub struct Linter<S: RuleSet> {
    registry: Registry,
    /// For each rule of `registry`, its number in `S`.
    numbers: Vec<u16>,
    /// What the configurations name by numbers.
    instances: Instances<Arc<S>>,
}

/// A rule as it runs on the file: as it is configured, or as a comment changes that.
struct Running<'r, S> {
    entry: &'static RuleEntry,
    /// What the configuration has for it.
    configured: Option<&'r ConfiguredRule>,
    severity: Severity,
    /// [`Slot::in_oxlint`]
    in_oxlint: InOxlint,
    rule: RuleRef<'r, S>,
    /// [`ConfiguredRule::refusal`]
    refusal: Option<Cow<'r, [u8]>>,
}

impl<'r, S> Running<'r, S> {
    #[inline]
    fn ran(&self) -> Ran<'r> {
        Ran {
            entry: self.entry,
            configured: self.configured,
            severity: self.severity,
        }
    }
}

/// What of a [`Running`] is read when the rules have run.
#[derive(Copy, Clone)]
struct Ran<'r> {
    entry: &'static RuleEntry,
    configured: Option<&'r ConfiguredRule>,
    severity: Severity,
}

impl<'r> Ran<'r> {
    /// [`ConfiguredRule::reported_as`]
    #[inline]
    fn reported_as(self) -> &'static Meta {
        (self.configured).map_or(self.entry.meta, ConfiguredRule::reported_as)
    }

    /// [`ConfiguredRule::name`]
    #[inline]
    fn name(self) -> Option<&'r Arc<[u8]>> {
        self.configured.and_then(ConfiguredRule::name)
    }

    /// ESLint's `ruleId` of what it reports.
    fn id(self) -> RuleId {
        match self.name() {
            Some(name) => RuleId::Named(self.entry.meta, Arc::clone(name)),
            None => RuleId::Known(self.reported_as()),
        }
    }
}

enum RuleRef<'r, S> {
    Shared(&'r S),
    /// Made for this file, from the options in a comment.
    Own(Box<S>),
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
    /// One that has a [name](ConfiguredRule::name).
    Instance(&'c ConfiguredRule, &'c Arc<[u8]>),
    Js(&'c Arc<js_plugin::Rule>),
}

impl Named<'_> {
    fn id(self) -> RuleId {
        match self {
            Named::Native(entry) => RuleId::Known(entry.meta),
            Named::Instance(rule, name) => RuleId::Named(rule.entry.meta, Arc::clone(name)),
            Named::Js(rule) => RuleId::Js(Arc::clone(rule)),
        }
    }

    fn is(self, other: Named) -> bool {
        match (self, other) {
            (Named::Native(a), Named::Native(b)) => is_same_rule(a, b),
            (Named::Instance(_, a), Named::Instance(_, b)) => a == b,
            (Named::Js(a), Named::Js(b)) => Arc::ptr_eq(a, b),
            _ => false,
        }
    }

    /// [`schema::validate`]. `Ok`: what a rule of a JavaScript plugin gets as its options.
    fn validate(self, options: &[Json], stands_alone: bool) -> Result<Vec<Json>, Vec<u8>> {
        match self {
            Named::Native(entry) | Named::Instance(&ConfiguredRule { entry, .. }, _) => {
                schema::validate(entry.meta, options, stands_alone).map(|()| Vec::new())
            }
            Named::Js(rule) => schema::validate_js(rule, options),
        }
    }

    fn with_defaults(self, options: &[Json]) -> Vec<Json> {
        match self {
            Named::Native(entry) | Named::Instance(&ConfiguredRule { entry, .. }, _) => {
                schema::with_defaults(entry.meta, options)
            }
            Named::Js(rule) => schema::with_js_defaults(rule, options),
        }
    }
}

impl<'c> Named<'c> {
    /// The rule, if it is one of a JavaScript plugin.
    fn js(self) -> Option<&'c js_plugin::Rule> {
        match self {
            Named::Native(_) | Named::Instance(..) => None,
            Named::Js(rule) => Some(rule),
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

impl<S: RuleSet> Linter<S> {
    /// `registry`: rules of `S`.
    pub fn new(registry: Registry) -> Linter<S> {
        let mut numbers = vec![u16::MAX; registry.all().len()];
        for (number, meta) in S::METAS.iter().enumerate() {
            if let Some(index) = meta.and_then(|it| registry.index_of_meta(it)) {
                numbers[index] = number as u16;
            }
        }
        Linter {
            registry,
            numbers,
            instances: Instances::new(),
        }
    }

    /// The rule at `index` of the registry, made from `options`.
    fn build(&self, index: usize, options: &[Json]) -> Option<S> {
        S::build(*self.numbers.get(index)?, &Options::new(options))
    }

    /// [`Rule::validate`](crate::rule::Rule::validate) of `entry`.
    pub fn validate(&self, entry: &RuleEntry, options: &[Json]) -> Result<(), Vec<u8>> {
        let index = self.registry.index_of(entry);
        match index.and_then(|it| self.numbers.get(it)) {
            Some(number) => S::validate(*number, &Options::new(options)),
            None => Ok(()),
        }
    }

    /// What `rule`, which is on, throws for its options.
    fn refusal<'c>(&self, rule: &'c ConfiguredRule) -> Option<&'c [u8]> {
        let ask = || Some(Arc::from(self.validate(rule.entry, &rule.options).err()?));
        rule.refusal.get_or_init(ask).as_deref()
    }

    /// [`ResolvedConfig::prepared`]
    fn prepare(&self, config: &ResolvedConfig) -> Prepared {
        let mut on = RuleBits::EMPTY;
        let (mut order, mut typed, mut refusal) = (Vec::new(), Vec::new(), None);
        for (at, rule) in config.rules.iter().enumerate() {
            let Some(instance) = self.instance(rule) else {
                continue;
            };
            let number = instance.number();
            on.insert(number);
            let in_oxlint = match config.language.is_oxlint {
                true => crate::oxlint_order::of(rule.reported_as()),
                false => InOxlint::unknown(rule.entry.meta.reports, 0),
            };
            let at = at as u32;
            let severity = rule.severity;
            let slot = Slot {
                at,
                number,
                in_oxlint,
                severity,
            };
            order.push((in_oxlint.number, slot, Arc::clone(instance)));
            if rule.entry.meta.requires_types {
                typed.push(rule.entry.meta);
            }
            if refusal.is_none() {
                refusal = self.refusal(rule).map(Arc::from);
            }
        }
        order.sort_by_key(|it| it.0);
        let rules: Vec<Arc<S>> = order.iter().map(|it| Arc::clone(&it.2)).collect();
        let numbers: Vec<u16> = order.iter().map(|it| it.1.number).collect();
        Prepared {
            on,
            listeners: Listeners::new::<S>(&numbers),
            order: order.into_iter().map(|it| it.1).collect(),
            rules: Arc::new(rules),
            refusal,
            typed: typed.into(),
            needs_modules: config.rules.iter().any(|it| it.entry.meta.needs_modules),
        }
    }

    /// `rule` made from its options. `None` if it is off.
    fn instance(&self, rule: &ConfiguredRule) -> Option<&Arc<S>> {
        if rule.severity == Severity::Off {
            return None;
        }
        let at = match rule.instance.get() {
            Some(at) => *at,
            None => {
                let index = self.registry.index_of(rule.entry)?;
                let make = || self.build(index, &rule.options).map(Arc::new);
                let at = self.instances.of(index, &rule.options, make)?;
                *rule.instance.get_or_init(|| at)
            }
        };
        self.instances.get(at)
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
        let mut problems: Vec<LintMessage> = Vec::new();
        let (mut fatal, is_of_parser) = syntax::parse_errors_and_stage(file);
        if !fatal.is_empty() {
            let is_oxlint = file.language().is_oxlint;
            if is_oxlint && is_of_parser && syntax::is_flow(file) {
                return LintResult::default();
            }
            // What oxc refuses, oxlint does not lint. tsgolint reads the file on its own, and oxlint, which has not seen the comments,
            // passes on all that it reports. Here that is so where the tree is whole: the error is an early one.
            if !is_oxlint || file.types.is_none() || file.has_parse_errors() {
                return LintResult {
                    messages: fatal,
                    ..LintResult::default()
                };
            }
            problems.append(&mut fatal);
        }
        let is_refused = !problems.is_empty();
        let mut result = LintResult::default();
        let enabled_js =
            (config.js_rules.iter()).filter(|it| it.severity != Severity::Off && !is_refused);
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
        let comments = match options.allow_inline_config && !is_refused {
            true => file.config_comments(),
            false => &[],
        };
        // ESLint takes `oxlint-disable` and the like for ordinary comments. Without a configuration of either, those of both count.
        let is_understood = |it: &&ConfigComment| {
            let is_called_oxlint = file.slice(it.label_span).starts_with(b"oxlint");
            match config.understands_oxlint_comments {
                true => is_called_oxlint || options.respects_eslint_comments,
                false => config.has_every_rule || (!is_called_oxlint && !it.is_only_of_oxlint),
            }
        };
        let prepared = config.prepared.get_or_init(|| self.prepare(config));
        // Nothing but the configuration says which rules run, and how: then a rule for which the file has nothing is left out from
        // the start.
        let is_plain = !is_refused
            && options.rule_filter.is_none()
            && options.again.is_none()
            && (config.linter.no_inline_config
                || !configures_in_comments
                || !(comments.iter().filter(is_understood)).any(|it| it.label == Label::Rules));
        let listening = is_plain.then(|| prepared.listeners.of(file));
        debug_assert!(listening.as_ref().is_none_or(|places| {
            let numbers = crate::runner::listening::<S>(file, &prepared.on);
            (prepared.order.iter().enumerate()).all(|(place, slot)| {
                numbers.has(slot.number) == (places[place / 64] & (1 << (place % 64)) != 0)
            })
        }));
        let count = match &listening {
            Some(listening) => listening.iter().map(|it| it.count_ones() as usize).sum(),
            None => prepared.order.len(),
        };
        let made = prepared.rules.downcast_ref::<Vec<Arc<S>>>();
        let made = made.map_or(&[][..], |it| &it[..]);
        // The rules that run, each with its place: where `is_plain`, in `prepared.order`. Else in `running`.
        let mut running: Vec<Running<S>> = Vec::new();
        let mut enabled: Vec<Enabled<S>> = Vec::with_capacity(count);
        if let Some(listening) = &listening {
            for (word, &bits) in listening.iter().enumerate() {
                each_bit(bits, |bit| {
                    let place = 64 * word + bit;
                    if let (Some(slot), Some(instance)) =
                        (prepared.order.get(place), made.get(place))
                    {
                        enabled.push(Enabled {
                            rule: &**instance,
                            severity: slot.severity,
                            place: place as u32,
                        });
                    }
                });
            }
        }
        running.reserve(if is_plain { 0 } else { count });
        let others = (prepared.order.iter().zip(made)).filter(|_| !is_plain);
        for (slot, instance) in others {
            let Some(rule) = config.rules.get(slot.at as usize) else {
                continue;
            };
            if !is_refused || rule.entry.meta.requires_types {
                running.push(Running {
                    entry: rule.entry,
                    configured: Some(rule),
                    severity: rule.severity,
                    in_oxlint: slot.in_oxlint,
                    rule: RuleRef::Shared(instance),
                    refusal: self.refusal(rule).map(Cow::Borrowed),
                });
            }
        }
        let (mut parents, mut disable_directives) = (Vec::new(), Vec::new());
        if config.linter.no_inline_config {
            for comment in comments.iter().filter(is_understood) {
                let written = file.slice(comment.span);
                let message = match &config.language.eslint_8 {
                    Some(eslint_8) => eslint_8
                        .has_no_effect(file.slice(comment.label_span), written.starts_with(b"/*")),
                    None => quoted(&[
                        b"'",
                        written,
                        b"' has no effect because you have 'noInlineConfig' setting in your config.",
                    ]),
                };
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
                by_other_name: Vec::new(),
            };
            for comment in comments.iter().filter(is_understood) {
                inline.apply(comment, &mut running, &mut running_js);
            }
            for comment in comments.iter().filter(is_understood) {
                inline.disable_directives(comment, &mut parents, &mut disable_directives);
            }
        }
        let mut off: Vec<RuleId> = Vec::new();
        if config.has_every_rule {
            let is_on = |id: &RuleId| match is_plain {
                _ if matches!(id, RuleId::Js(_)) => (running_js.iter()).any(|it| {
                    it.severity != Severity::Off
                        && RuleId::Js(Arc::clone(&it.configured.rule)) == *id
                }),
                true => (config
                    .rules
                    .iter()
                    .filter(|it| it.severity != Severity::Off))
                .any(|it| RuleId::Known(it.reported_as()) == *id),
                false => (running.iter().filter(|it| it.severity != Severity::Off))
                    .any(|it| it.ran().id() == *id),
            };
            let named = disable_directives.iter().filter_map(|it| it.rule.as_ref());
            for rule in named.filter(|it| !is_on(it)) {
                if !off.contains(rule) {
                    off.push(rule.clone());
                }
            }
        }

        for id in &config.missing_rules {
            problems.push(LintMessage {
                rule_id: Some(RuleId::Unknown(id.clone())),
                message: registry::missing_rule_message(id),
                line: 1,
                column: 1,
                end: Some((1, 2)),
                ..LintMessage::default()
            });
        }

        // ESLint's `markExportedVariables`.
        for name in file.exported_in_comments() {
            if let Some(symbol) = file.scope().get_bytes(name) {
                symbol.mark_exported();
            }
        }

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
        // Read where comments are applied.
        let mut rules_to_ignore = Vec::new();
        // A comment for a rule that was skipped isn't called unused. oxlint does call it unused.
        let ignores_skipped_rules = !config.language.is_oxlint;
        if let Some(filter) = options.rule_filter {
            running.retain(|it| {
                let id = it.ran().id();
                let runs = it.severity == Severity::Off || filter(&id, it.severity);
                if !runs && ignores_skipped_rules {
                    rules_to_ignore.push(id);
                }
                runs
            });
            running_js.retain(|it| {
                let id = RuleId::Js(Arc::clone(&it.configured.rule));
                let runs = filter(&id, it.severity);
                if !runs && ignores_skipped_rules {
                    rules_to_ignore.push(id);
                }
                runs
            });
        }
        // ESLint makes the rules that run, and one of them throws.
        let mut refusals = (running.iter().filter(|it| it.severity != Severity::Off))
            .filter_map(|it| it.refusal.as_deref());
        let refusal = match is_plain {
            true => prepared.refusal.as_deref(),
            false => refusals.next(),
        };
        if let Some(refusal) = refusal {
            return LintResult {
                thrown: Some([refusal, b"\nOccurred while linting ", file.path()].concat()),
                ..LintResult::default()
            };
        }
        // Rules that need types are skipped when there are none.
        let skips_typed_rules = file.types.is_none() && ignores_skipped_rules;
        if skips_typed_rules && is_plain {
            if has_directives {
                rules_to_ignore.extend(prepared.typed.iter().copied().map(RuleId::Known));
            }
        } else if skips_typed_rules && !options.again.is_some_and(|it| it.had_types) {
            let without_types = running
                .iter()
                .filter(|it| it.severity != Severity::Off && it.entry.meta.requires_types);
            rules_to_ignore.extend(without_types.map(|it| RuleId::Known(it.entry.meta)));
        }
        if options.js_plugins.is_none() {
            let skipped = running_js.iter();
            rules_to_ignore.extend(skipped.map(|it| RuleId::Js(Arc::clone(&it.configured.rule))));
        }
        let before_previous = problems.len();
        if let Some(again) = options.again {
            running.retain(|it| it.entry.meta.needs_modules);
            let is_of_another_rule = |it: &&LintMessage| {
                (it.message_id.is_some() || is_thrown_error(it))
                    && !matches!(&it.rule_id, Some(RuleId::Known(meta)) if meta.needs_modules)
            };
            let previous = (again.previous.messages.iter()).chain(&again.previous.suppressed);
            problems.extend(previous.filter(is_of_another_rule).map(|it| LintMessage {
                suppressions: Vec::new(),
                ..it.clone()
            }));
        }
        let before_js = problems.len();
        let wants_fixes = options.wants_fixes && !options.disables_fixes;
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
                    !options.disables_fixes,
                    options.physical_path_len,
                    options.parse_again,
                ) {
                    Ok(reports) => {
                        problems.reserve(reports.len());
                        for report in reports {
                            if let Some(rule) = running_js.get(report.rule as usize) {
                                problems.push(js_message(report, rule, wants_fixes));
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
        if let Some(module) = &config.package_module {
            file.set_package_module(Arc::clone(module));
        }
        // A rule for which the file has nothing is not started.
        if !is_plain {
            enabled.extend(running.iter().zip(0..).map(|(it, place)| Enabled {
                rule: match &it.rule {
                    RuleRef::Shared(rule) => *rule,
                    RuleRef::Own(rule) => &**rule,
                },
                severity: it.severity,
                place,
            }));
            let mut on = RuleBits::EMPTY;
            for it in enabled.iter().filter(|it| it.severity != Severity::Off) {
                let number = it.rule.number();
                on.insert(number);
            }
            let listening = crate::runner::listening::<S>(file, &on);
            for it in &mut enabled {
                if !listening.has(it.rule.number()) {
                    it.severity = Severity::Off;
                }
            }
        }
        let wants_places = options.wants_places || wants_fixes || has_directives;
        let of_js = problems.len() - before_js;
        for (it, reported) in problems.iter_mut().skip(before_js).zip(1..) {
            it.reported = reported;
        }
        file.sink.wants_help.set(options.wants_help);
        file.sink.drops_messages.set(!options.wants_messages);
        (file.sink.drops_texts_of_fixes).set(!options.wants_texts_of_fixes);
        let ran = |index: usize| -> Option<Ran> {
            if !is_plain {
                return running.get(index).map(Running::ran);
            }
            let slot = prepared.order.get(enabled.get(index)?.place as usize)?;
            let rule = config.rules.get(slot.at as usize)?;
            Some(Ran {
                entry: rule.entry,
                configured: Some(rule),
                severity: slot.severity,
            })
        };
        let mut diagnostics = crate::runner::run(file, &enabled, wants_fixes);
        if let Some(thrown) = file.sink.thrown.take() {
            // "error:" stands for the plain `Error:` where the run ends.
            let said = match (thrown.name, file.language().is_oxlint) {
                ("Error", false) => thrown.message,
                (name, _) => [name.as_bytes(), b": ", &thrown.message].concat(),
            };
            let id = ran(thrown.rule as usize).map_or_else(Vec::new, |it| it.id().to_vec());
            let error = ThrownError {
                said: &said,
                at: match thrown.at {
                    Some(at) => js_plugin::ThrownAt::Line(file.line_of(at)),
                    None => js_plugin::ThrownAt::Unknown,
                },
                rule: thrown.at.map(|_| &id[..]),
            };
            match error.outcome(file.path(), config) {
                Ok(problem) => {
                    diagnostics.retain(|it| it.rule != thrown.rule);
                    // oxlint stops at the first error, so a file has one at most. It comes where the JavaScript plugins' findings do.
                    if !problems.iter().any(is_thrown_error) {
                        problems.push(LintMessage {
                            reported: of_js as u32 + 1,
                            ..problem
                        });
                    }
                }
                Err(thrown) => {
                    return LintResult {
                        thrown: Some(thrown),
                        ..LintResult::default()
                    };
                }
            }
        }
        problems.reserve(diagnostics.len());
        if wants_places {
            file.expect_positions(diagnostics.len());
        }
        // oxlint sorts nothing. It prints what its rules report in the order in which it runs them.
        let follows_run = wants_places && file.language().is_oxlint && !diagnostics.is_empty();
        // When oxlint runs a rule, and with which kinds of node it calls it.
        let in_oxlint = |rule: usize| match is_plain {
            true => {
                let place = enabled.get(rule)?.place as usize;
                Some(&prepared.order.get(place)?.in_oxlint)
            }
            false => Some(&running.get(rule)?.in_oxlint),
        };
        // A file is linted again for a rule that has asked about the other files.
        let wants_keys =
            follows_run && prepared.needs_modules && file.sink.asks_about_modules.get();
        let about = |rule: u16| in_oxlint(rule as usize);
        let (by_run, run_keys) = match follows_run {
            true => crate::oxlint_order::in_run_order(file, &diagnostics, &about, wants_keys),
            false => (Vec::new(), Vec::new()),
        };
        let of_rules = by_run.len() as u32;
        // What was reported when the file was linted before, among which what is reported now belongs.
        let keys_before = options
            .again
            .map_or(&[][..], |it| &it.previous.run_keys[..]);
        let before_in_run = |step: u32| {
            let key = run_keys.get(step as usize - 1);
            key.map_or(0, |key| keys_before.partition_point(|it| it <= key) as u32)
        };
        // Only the comments want them by their places. Without any they are made in the order in which they are printed.
        let in_run_order = follows_run && !has_directives;
        // Else, for each of them, the how manyth it is printed, from 1.
        let mut ranks: Vec<u32> = vec![0; if in_run_order { 0 } else { by_run.len() }];
        for (at, rank) in by_run.iter().zip(1..) {
            if let Some(it) = ranks.get_mut(*at as usize) {
                *it = rank + before_in_run(rank);
            }
        }
        let order: Vec<u32> = match wants_places {
            _ if diagnostics.is_empty() => Vec::new(),
            _ if in_run_order => by_run,
            true => {
                let rules = 0..if follows_run {
                    enabled.len().max(running.len())
                } else {
                    0
                };
                let when: Vec<When> = rules.map_while(|it| Some(in_oxlint(it)?.when)).collect();
                crate::runner::sorted(&diagnostics, &when)
            }
            false => (0..diagnostics.len() as u32).collect(),
        };
        // What was reported before comes after: plugins in JavaScript run last, and what is run again runs first.
        for it in problems.iter_mut().skip(before_previous) {
            if it.reported != 0 && it.reported != u32::MAX {
                it.reported += match keys_before.get(it.reported as usize - 1) {
                    Some(key) => run_keys.partition_point(|it| it < key) as u32,
                    None => of_rules,
                };
            }
        }
        let places = wants_places.then_some(&locator);
        // What becomes of what the last rule and `messageId` change that change something.
        let mut changes = (None, config::OxlintChanges::default());
        for (at, step) in order.into_iter().zip(1..) {
            let Some(diagnostic) = diagnostics.get_mut(at as usize) else {
                continue;
            };
            let Some(rule) = ran(diagnostic.rule as usize) else {
                continue;
            };
            let changes_something = diagnostic.fix.is_some() || !diagnostic.suggestions.is_empty();
            let follows_oxlint = changes_something && file.language().is_oxlint;
            let key = Some((diagnostic.rule, diagnostic.message_id));
            if follows_oxlint && changes.0 != key {
                changes = (
                    key,
                    config::oxlint_changes(rule.reported_as(), diagnostic.message_id),
                );
            }
            problems.push(LintMessage {
                reported: match in_run_order {
                    true => step + before_in_run(step),
                    false => ranks.get(at as usize).copied().unwrap_or(0),
                },
                ..to_message(diagnostic, rule.reported_as(), places)
            });
            let Some(message) =
                (problems.last_mut()).filter(|_| changes_something || rule.name().is_some())
            else {
                continue;
            };
            if rule.name().is_some() {
                message.rule_id = Some(rule.id());
            }
            if follows_oxlint {
                change_as_oxlint(message, changes.1);
            }
            if changes_something && file.language().eslint_8.is_some() {
                let (fixes, suggests) = config::eslint8::changes_of(rule.reported_as());
                message.fix = message.fix.take().filter(|_| fixes);
                if !suggests {
                    message.suggestions.clear();
                }
            }
        }
        drop(diagnostics);
        // The rule of the package looks at a file that the rule here cannot answer for as it would.
        if let Some(reason) = file.handed_back() {
            result.handed_back = Some(reason);
            // Each with the id of the rule for which it stands in, which is what the comments name.
            let back: Vec<(RunningJs, RuleId)> = (0..enabled.len())
                .filter_map(ran)
                .filter(|it| it.entry.meta.hands_back && it.severity != Severity::Off)
                .filter_map(|it| {
                    let rule = RunningJs {
                        severity: it.severity,
                        configured: Cow::Borrowed(&it.configured?.or_else()?.configured),
                    };
                    Some((rule, it.id()))
                })
                .collect();
            let enabled: Vec<&js_plugin::Configured> =
                back.iter().map(|it| &**it.0.configured).collect();
            let reports = match (options.js_plugins, &config.js_settings) {
                (Some(host), Some(settings)) if !enabled.is_empty() => {
                    if file.text().len() < js_plugin::HEAVY {
                        host.comes(file.text().len() as u64);
                    }
                    host.run_on_block(
                        file,
                        settings,
                        &enabled,
                        !options.disables_fixes,
                        options.physical_path_len,
                        options.parse_again,
                    )
                }
                // Nothing here runs JavaScript.
                _ => Ok(Vec::new()),
            };
            match reports {
                Ok(reports) => {
                    let of_rule = |it: js_plugin::Report| {
                        let (rule, id) = back.get(it.rule as usize)?;
                        Some(LintMessage {
                            rule_id: Some(id.clone()),
                            ..js_message(it, rule, wants_fixes)
                        })
                    };
                    problems.extend(reports.into_iter().filter_map(of_rule));
                }
                Err(failure) => {
                    let rule = failure.rule.and_then(|it| Some(&back.get(it as usize)?.0));
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
        }
        // oxlint runs its own rules first. Comments are applied to what is at one place in that order.
        if file.language().is_oxlint {
            problems[before_js..].rotate_left(of_js);
            // When a rule of a JavaScript plugin throws, oxlint has nothing of any such rule for the file, and all of its own rules'
            // findings.
            if problems.iter().any(is_thrown_error) {
                problems.retain(|it| !it.rule_id.as_ref().is_some_and(stands_for_js_rule));
            }
        }
        if wants_places && !in_run_order {
            LintMessage::sort(&mut problems);
        }

        let report_unused = (options.report_unused_disable_directives)
            .unwrap_or(config.linter.report_unused_disable_directives);
        let has_skipped_rules = || match config.skipped {
            Skipped::None => false,
            Skipped::OnlyJsdoc => bun_core::strings::contains(file.text(), b"/**"),
            Skipped::Any => true,
        };
        let can_tell = |name: &[u8]| {
            // Every rule that's on ran, so a comment that silences nothing here silences nothing in oxlint either.
            if config.find_js_rule(name).is_some() || !has_skipped_rules() {
                return true;
            }
            // oxlint goes by what is after the last `/`, so a rule that was skipped may be meant if it's called that.
            let slash = bun_core::strings::last_index_of_char(name, b'/');
            let last = slash.map_or(name, |it| &name[it + 1..]);
            let is_here = || (self.registry.all().iter()).any(|it| it.meta.name.as_bytes() == last);
            !config::is_rule_not_built_in(last) && (!config::is_rule_of_oxlint(last) || is_here())
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
                            has_skipped_rules: &has_skipped_rules,
                            can_tell: &can_tell,
                        },
                        comments.iter().filter(is_directive).filter(is_understood),
                        messages,
                    );
                    LintMessage::sort(messages);
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
                            has_skipped_rules: config.skipped != Skipped::None,
                            off: &off,
                        },
                        messages,
                    );
                }
            };
        if has_directives {
            apply_comments(
                report_unused,
                wants_fixes,
                options.wants_suppressions,
                &mut problems,
            );
        }

        if file.language().is_oxlint && !problems.is_sorted_by_key(|it| it.reported) {
            crate::utils::sort::sort_by_key(&mut problems, |it| it.reported);
        }
        result.run_keys = run_keys;
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
            data: Data::None,
            fix,
            kind,
        };
        message.suggestions.insert(0, suggestion);
    }
}

/// Takes out of `diagnostic` what is on the heap. `locator`: `None` if nothing reads where it is.
#[inline]
fn to_message(
    diagnostic: &mut Diagnostic,
    rule: &'static Meta,
    locator: Option<&Locator>,
) -> LintMessage {
    let position = |offset: u32| locator.map_or((0, 0), |it| it.position(offset));
    let details = diagnostic.details.take();
    let (start, end) = locator.map_or_else(Default::default, |it| it.positions(diagnostic.span));
    let (line, column) = match details.as_deref().and_then(|it| it.start_position) {
        Some(start) => (start.line, start.column.wrapping_add(1)),
        None => start,
    };
    let end_position = details.as_deref().and_then(|it| it.end_position);
    LintMessage {
        rule_id: Some(RuleId::Known(rule)),
        severity: diagnostic.severity,
        message: std::mem::take(&mut diagnostic.message),
        message_id: Some(Cow::Borrowed(diagnostic.message_id)),
        line,
        column,
        end: (!diagnostic.has_no_end).then(|| match end_position {
            // A column of -1, which ESLint has, is `u32::MAX`.
            Some(end) => (end.line, end.column.wrapping_add(1)),
            None => end,
        }),
        is_fatal: false,
        fix: diagnostic.fix.take(),
        suggestions: match diagnostic.suggestions.is_empty() {
            true => Vec::new(),
            false => (diagnostic.suggestions.drain(..).map(Into::into)).collect(),
        },
        suppressions: Vec::new(),
        comments_apply_at: (details.as_deref().and_then(|it| it.comments_apply_at))
            .map(|it| (position(it.start), position(it.end))),
        not_numbers: NotNumbers::default(),
        details: details.map(|it| {
            let place = |(span, text): (Span, Cow<'static, str>)| {
                (position(span.start), position(span.end), text)
            };
            Box::new(Details {
                first_label: it.first_label,
                labels: it.labels.into_iter().map(place).collect(),
                help: it.help,
                note: it.note,
                typescript_code: 0,
            })
        }),
        constant_help: diagnostic.constant_help,
        reported: 0,
    }
}

/// `wants_fixes`: [`LintOptions::wants_fixes`]
fn js_message(report: js_plugin::Report, rule: &RunningJs, wants_fixes: bool) -> LintMessage {
    let id = report.message_id;
    LintMessage {
        rule_id: Some(RuleId::Js(Arc::clone(&rule.configured.rule))),
        severity: rule.severity,
        message: report.message,
        message_id: Some(id.map_or(Cow::Borrowed(""), |id| Cow::Owned(id.into()))),
        line: report.line.unwrap_or(0),
        column: report.column.unwrap_or(0),
        end: report.end,
        is_fatal: false,
        fix: report.fix.filter(|_| wants_fixes),
        suggestions: (report.suggestions.into_iter().filter(|_| wants_fixes))
            .map(Into::into)
            .collect(),
        suppressions: Vec::new(),
        comments_apply_at: None,
        not_numbers: NotNumbers {
            line: report.line.is_none(),
            column: report.column.is_none(),
        },
        details: None,
        constant_help: None,
        reported: 0,
    }
}

/// What becomes of a rule of a JavaScript plugin that throws. `Err`: ESLint throws it on. oxlint reports it for the file.
fn js_failure(
    failure: &js_plugin::Failure,
    rule: Option<&RunningJs>,
    path: &[u8],
    config: &ResolvedConfig,
) -> Result<LintMessage, Vec<u8>> {
    let error = ThrownError {
        said: &failure.message,
        at: failure.at,
        rule: rule.map(|it| &it.configured.rule.id[..]),
    };
    error.outcome(path, config)
}

/// Whether `problem` is what [`ThrownError::outcome`] makes for oxlint. Every other fatal problem is at a place in the file.
fn is_thrown_error(problem: &LintMessage) -> bool {
    problem.is_fatal && problem.line == 0
}

/// Whether oxlint could only run the rule as a rule of a JavaScript plugin: it is one, or it's a native rule that oxlint doesn't have.
fn stands_for_js_rule(id: &RuleId) -> bool {
    match id {
        RuleId::Js(_) => true,
        RuleId::Known(meta) | RuleId::Named(meta, _) => config::oxlint_lacks(meta),
        RuleId::Unknown(_) => false,
    }
}

/// An error that a rule has thrown, whether the rule is JavaScript or calls [`Cx::throw`](crate::context::Cx::throw).
struct ThrownError<'e> {
    /// The error as the tool prints it, without the stack.
    said: &'e [u8],
    at: js_plugin::ThrownAt,
    /// ESLint's `ruleId`
    rule: Option<&'e [u8]>,
}

impl ThrownError<'_> {
    /// `path`: the file that was being linted. `Ok`: oxlint reports this for the file and goes on. `Err`: ESLint ends the run and
    /// prints this.
    fn outcome(&self, path: &[u8], config: &ResolvedConfig) -> Result<LintMessage, Vec<u8>> {
        if !config.prefers_typescript_rules {
            let occurred: &[u8] = b"\nOccurred while linting ";
            let line = match self.at {
                // ESLint's `createRuleListeners` names the rule in the message, and then there's no line for it.
                js_plugin::ThrownAt::Create => {
                    let (loading, rule): (&[u8], _) = (b"Error while loading rule '", self.rule);
                    let rule = rule.unwrap_or_default();
                    return Err([loading, rule, b"': ", self.said, occurred, path].concat());
                }
                js_plugin::ThrownAt::Line(line) => format!(":{line}"),
                js_plugin::ThrownAt::Unknown => String::new(),
            };
            let named = (self.rule).map(|rule| [b"\nRule: \"", rule, b"\""].concat());
            let named = named.unwrap_or_default();
            return Err([self.said, occurred, path, line.as_bytes(), &named].concat());
        }
        Ok(LintMessage {
            rule_id: None,
            severity: Severity::Error,
            message: [
                b"Error running JS plugin.\nFile path: ",
                path,
                b"\n",
                self.said,
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
            not_numbers: NotNumbers::default(),
            details: None,
            constant_help: None,
            reported: 0,
        })
    }
}

/// Applies the comments of a file to its configuration.
struct Inline<'i, 'c, 'a, S: RuleSet> {
    linter: &'c Linter<S>,
    file: &'a File<'a>,
    config: &'c ResolvedConfig,
    locator: &'i Locator<'a>,
    problems: &'i mut Vec<LintMessage>,
    skipped: &'i mut Vec<Box<[u8]>>,
    /// The rules that a comment has configured already.
    configured: Vec<Named<'c>>,
    /// The subset of `configured` that was set [through the paired rule's name](Inline::set_by).
    by_other_name: Vec<Named<'c>>,
}

impl<'c, 'a, S: RuleSet> Inline<'_, 'c, 'a, S> {
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
    /// configuration knows, or the rule is left to `bun fmt`. `is_turned_on`: by the comment, so that it is missed.
    fn find(
        &mut self,
        comment: &ConfigComment,
        id: &[u8],
        is_turned_on: bool,
    ) -> Option<Named<'c>> {
        let config = self.config;
        if let Some(rule) = config.named_rule(id)
            && let Some(name) = rule.name()
        {
            return Some(Named::Instance(rule, name));
        }
        let js = config.find_js_rule(id);
        let native = || (config.find_rule(&self.linter.registry, id)).map(Named::Native);
        let lacks_it = config.lacks_rule(id);
        let is_about_layout =
            !lacks_it && (config.formatting_rule(&self.linter.registry, id)).is_some();
        let found = match js {
            _ if lacks_it || is_about_layout => None,
            // What `jsPlugins` names hides a plugin of the same name that is implemented here.
            Some(js)
                if config.skips_unknown_rules
                    && !config.prefers_native_rules_of(
                        &self.linter.registry,
                        registry::parse_rule_id(id).0,
                    ) =>
            {
                js.map(Named::Js)
            }
            Some(js) => native().or_else(|| js.map(Named::Js)),
            None => native(),
        };
        if found.is_none() {
            // All rules of a plugin that is loaded are known.
            let is_known_to_be_missing = lacks_it || js.is_some() && !config.skips_unknown_rules;
            // With every rule built in, there's no npm package that could provide the rule a comment enables.
            let is_of_a_package = !is_known_to_be_missing
                && self.config.is_foreign(id)
                && !(config.has_every_rule && is_turned_on);
            if is_about_layout || is_of_a_package {
                if is_turned_on && !self.skipped.iter().any(|it| **it == *id) {
                    self.skipped.push(id.into());
                }
            } else if is_turned_on || !config.has_every_rule {
                let message = registry::missing_rule_message(id);
                self.error(comment, Some(RuleId::Unknown(id.into())), message);
            }
        }
        found
    }

    /// Calls [`Registry::pair_of`], but only in configs where a pair acts as one rule.
    fn pair_of(&self, rule: Named) -> Option<(&'static RuleEntry, &'static RuleEntry)> {
        match rule {
            Named::Native(entry) if self.config.has_every_rule => {
                self.linter.registry.pair_of(entry.meta)
            }
            _ => None,
        }
    }

    /// Returns the rule that a config comment naming `rule` applies to in this file. `given` are the comment's options.
    /// For a [pair](Registry::pair_of) that's the typescript-eslint version in TypeScript files, unless it can't run or
    /// only the core rule accepts the options.
    fn set_by(&self, rule: Named<'c>, given: &[Json]) -> Named<'c> {
        let Some((base, extension)) = self.pair_of(rule) else {
            return rule;
        };
        let can_run = !extension.meta.requires_types || self.file.types.is_some();
        let stands_alone = self.file.language().stands_alone;
        let takes = |it: &RuleEntry| schema::validate(it.meta, given, stands_alone).is_ok();
        let is_for_base = self.file.is_javascript() || !can_run || !takes(extension) && takes(base);
        Named::Native(if is_for_base { base } else { extension })
    }

    /// Returns the rule that a disable comment naming `rule` applies to. For a pair that's whichever rule runs on this file.
    fn disabled_by(&self, rule: Named<'c>) -> Named<'c> {
        let Some((base, extension)) = self.pair_of(rule) else {
            return rule;
        };
        let is_of_pair = |it: &&Named| [base, extension].iter().any(|of| it.is(Named::Native(of)));
        if let Some(set) = self.configured.iter().find(is_of_pair) {
            return *set;
        }
        let is_on =
            |it: &RuleEntry| (self.config.rule(it)).is_some_and(|it| it.severity != Severity::Off);
        match (is_on(base), is_on(extension)) {
            (true, false) => Named::Native(base),
            (false, true) => Named::Native(extension),
            _ => self.set_by(rule, &[]),
        }
    }

    /// The part of ESLint's `applyInlineConfig` and of what `verify` does with its result that is
    /// about rules.
    fn apply(
        &mut self,
        comment: &ConfigComment,
        running: &mut Vec<Running<'c, S>>,
        running_js: &mut Vec<RunningJs<'c>>,
    ) {
        match comment.label {
            Label::Rules => {}
            Label::Env if self.file.language().eslint_8.is_some() => return,
            Label::Env if self.file.language().stands_alone => return,
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
        let eslint_8 = self.config.language.eslint_8.as_deref();
        for (id, value) in rules {
            let first = match &value {
                Json::Array(items) => items.first(),
                value => Some(value),
            };
            let is_turned_on = first.and_then(severity_of) != Some(Severity::Off);
            let Some(named) = self.find(comment, &id, is_turned_on) else {
                continue;
            };
            let given = match &value {
                Json::Array(items) => items.get(1..).unwrap_or_default(),
                _ => &[],
            };
            let rule = self.set_by(named, given);
            // A setting under the rule's own name beats one under the paired name, in either order.
            if !named.is(rule) {
                let is_configured = |it: &Named| it.is(rule);
                if self.configured.iter().any(is_configured)
                    && !self.by_other_name.iter().any(is_configured)
                {
                    continue;
                }
                self.by_other_name.push(rule);
            } else if let Some(at) = self.by_other_name.iter().position(|it| it.is(rule)) {
                self.by_other_name.swap_remove(at);
                self.configured.retain(|it| !it.is(rule));
            }
            // In ESLint 8 a comment says all there is to say about a rule, and the last comment counts.
            let value = match eslint_8.map(|it| it.inline_setting(&id, &value, rule.js())) {
                Some(Ok(setting)) => Json::Array(setting),
                Some(Err(message)) => {
                    self.error(comment, Some(rule.id()), message);
                    continue;
                }
                None => value,
            };
            if eslint_8.is_none() && self.configured.iter().any(|it| it.is(rule)) {
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
                    bun_core::strings::trim_js_whitespace(&full[colon + 1..]),
                    b" You passed \"",
                    &passed,
                    b"\".\n",
                ]);
                self.error(comment, Some(rule.id()), message);
                continue;
            };
            let existing = match rule {
                Named::Native(entry) => self.config.rule(entry).map(Existing::Native),
                Named::Instance(rule, _) => Some(Existing::Native(rule)),
                Named::Js(rule) => self.config.js_rule(rule).map(Existing::Js),
            };
            // A comment that has only a severity keeps the options of the configuration.
            let keeps_options = inline.len() == 1 && eslint_8.is_none();
            let over_defaults;
            let options: &[Json] = match existing {
                Some(existing) if keeps_options => existing.options(),
                Some(Existing::Native(existing)) if !existing.defaults.is_empty() => {
                    over_defaults = schema::deep_merge_arrays(&existing.defaults, &inline[1..]);
                    &over_defaults
                }
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
            let is_validated = eslint_8.is_some()
                || keeps_options && existing.is_some_and(|it| it.severity() != Severity::Off);
            // ESLint leaves out what is off only if that is written `0`.
            let is_zero = matches!(inline.first(), Some(Json::Number(n)) if *n == 0.0);
            let stands_alone = self.file.language().stands_alone;
            let validated = match is_validated || is_zero {
                true => None,
                // Options are valid for a pair if either rule accepts them.
                false => Some(rule.validate(options, stands_alone).or_else(|lines| {
                    let pair = self.pair_of(rule).map(|it| [it.0, it.1]);
                    let mut pair = pair.iter().flatten();
                    match pair.any(|it| schema::validate(it.meta, options, stands_alone).is_ok()) {
                        true => Ok(Vec::new()),
                        false => Err(lines),
                    }
                })),
            };
            if let Some(Err(lines)) = &validated {
                let message = quoted(&[
                    b"Inline configuration for rule \"",
                    &id,
                    b"\" is invalid:\n\t",
                    bun_core::strings::trim_js_whitespace(lines),
                    b"\n",
                ]);
                self.error(comment, Some(rule.id()), message);
                continue;
            }
            self.configured.push(rule);
            // Make sure the paired rule doesn't run too.
            if let Some((base, extension)) = self.pair_of(rule) {
                let rests = if rule.is(Named::Native(base)) {
                    extension
                } else {
                    base
                };
                running.retain(|it| !is_same_rule(it.entry, rests));
            }
            let (entry, existing) = match (rule, existing) {
                (Named::Native(entry), Some(Existing::Native(existing))) => (entry, Some(existing)),
                (Named::Native(entry), _) => (entry, None),
                (Named::Instance(rule, _), _) => (rule.entry, Some(rule)),
                (Named::Js(js), existing) => {
                    let is_it = |it: &RunningJs| Arc::ptr_eq(&it.configured.rule, js);
                    if severity == Severity::Off {
                        running_js.retain(|it| !is_it(it));
                        continue;
                    }
                    let new = RunningJs {
                        severity,
                        configured: match existing {
                            Some(Existing::Js(it)) if keeps_options => {
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
            let name = existing.and_then(ConfiguredRule::name);
            let is_it = |it: &Running<S>| is_same_rule(it.entry, entry) && it.ran().name() == name;
            let linter = self.linter;
            let shared = existing
                .filter(|_| keeps_options)
                .and_then(|it| linter.instance(it));
            let refusal = match shared {
                Some(_) => existing
                    .and_then(|it| linter.refusal(it))
                    .map(Cow::Borrowed),
                None if severity == Severity::Off => None,
                None => linter.validate(entry, options).err().map(Cow::Owned),
            };
            let rule = match shared {
                Some(rule) => RuleRef::Shared(&**rule),
                None if severity == Severity::Off => {
                    running.retain(|it| !is_it(it));
                    continue;
                }
                None => {
                    let index = linter.registry.index_of(entry);
                    match index.and_then(|it| linter.build(it, options)) {
                        Some(rule) => RuleRef::Own(Box::new(rule)),
                        None => continue,
                    }
                }
            };
            let new = Running {
                entry,
                configured: existing,
                severity,
                in_oxlint: InOxlint::unknown(entry.meta.reports, u16::MAX),
                rule,
                refusal,
            };
            match running.iter_mut().find(|it| is_it(it)) {
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
                    .all(|(a, b)| schema::is_equal(a, b))
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
            let Some(rule) = self.find(comment, name, false) else {
                return true;
            };
            let rule = self.disabled_by(rule);
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
            tool: match self.file.slice(comment.label_span).starts_with(b"oxlint") {
                true => "oxlint",
                false => "eslint",
            },
        });
    }
}

/// All threads share these.
const _: fn() = || {
    fn is_shared<T: Send + Sync>() {}
    is_shared::<Config>();
    is_shared::<ResolvedConfig>();
};
