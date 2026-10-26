//! Lints a Svelte component with the native rules, where the config sets up svelte-eslint-parser for it.
//!
//! The component is lowered to one program ([`lower`]). Every byte of the component appears in it exactly once, in
//! order: as code (the scripts, the expressions, the patterns and some markup names) or inside a block comment (the
//! rest of the markup and the style sheet). Synthesized code, the glue, goes between them and has no line breaks, so
//! each line of the program is the same line of the component. A template expression becomes the argument of a call to
//! an undeclared helper whose name appears nowhere in the component, a block becomes a block or a callback whose
//! parameters are the block's declarations, and a snippet becomes a function. Scope entries that svelte-eslint-parser
//! adds beyond what the code alone has go in more glue at the end, with copies of component names (stores, `$:`
//! variables), the generics' type parameters, or references the view adds (props, snippets passed to components).
//!
//! Rules see the program through its [`View`]: no node that starts in glue, no glue tokens or comments, the markup as
//! svelte-eslint-parser's tokens, and references repaired the way svelte-eslint-parser repairs them. Reports about glue
//! are still dropped before the file's comments are applied ([`Virtual::is_synthetic`]), and the rest are mapped back
//! to their place in the component ([`Virtual::to_original`]). A fix that changes glue is dropped, unless it removes
//! the code around the glue.
//!
//! Ports parts of svelte-eslint-parser, Copyright (c) 2021 Yosuke Ota, under the MIT License: see LICENSE.md.

use crate::configs::Loaded;
use crate::discover::{Status, Target};
use crate::lint::{Component, Context, How, too_deep};
use crate::paths;
use crate::results::FileResult;
use crate::svelte_summary::{Part as Of, is_function_bindings, summarize};
use bun_core::lexer::is_identifier;
use bun_core::strings;
use bun_format::svelte::ast::{
    self, DirectiveKind, ElementKind, Expression, ExpressionKind, Id, Kind, Pattern, Tree, Value,
};
use bun_format::syntax_error::{Message, SyntaxError};
use bun_lint::ast::svelte::shared;
use bun_lint::ast::svelte::{Lowered, RUNES, SVELTE_GLOBALS};
use bun_lint::ast::view::{Adjustment, Piece, Segment, View};
use bun_lint::ast::{ExprKind, File, Node, Pat, PatKind, StmtKind, VarKind};
use bun_lint::context::Severity;
use bun_lint::fix::Fix;
use bun_lint::js_plugin::{self, Route};
use bun_lint::language::{Global, LanguageOptions, Parser, SourceType};
use bun_lint::linter::{
    Again, ConfiguredJsRule, Entry, LintMessage, LintResult, ResolvedConfig, RuleId, ThrownWhile,
    parse_error,
};
use bun_lint::options::Json;
use bun_lint::rule::Plugin;
use bun_lint::runner::RuleEntry;
use bun_lint::semantic::{Declaration, Symbol};
use bun_lint::source::Places;
use bun_lint::span::{Domain, Position, Span};
use bun_lint::tokens::TokenKind;
use bun_lint::utils::estree_compat::estree_type_name;
use bun_lint::utils::sort;
use bun_sema::resolve::ScriptKind;
use bun_threading::Guarded;
use std::sync::{Arc, OnceLock};

mod typed;
pub(crate) use typed::TypedOutcome;

/// Component state shared by all files in a run.
#[derive(Default)]
pub(crate) struct Shared {
    /// The program configs: one per component config, with or without TypeScript, in runes mode or not.
    configs: Guarded<Vec<Derived>>,
    /// For each component config, the rules that only ESLint runs on components.
    residuals: Guarded<Vec<(Arc<ResolvedConfig>, Option<Arc<Residual>>)>>,
    /// For each config of `.svelte.js` and `.svelte.ts` files, the same config with the runes as globals.
    scripts: Guarded<Vec<(Arc<ResolvedConfig>, Arc<ResolvedConfig>)>>,
    /// For each of those, the rules that only ESLint runs on such files.
    script_residuals: Guarded<Vec<(Arc<ResolvedConfig>, Option<Arc<Residual>>)>>,
    /// For each component config, the config with the [native rules](native_for) replacing eslint-plugin-svelte's, and
    /// their names.
    with_natives: Guarded<Vec<(Arc<ResolvedConfig>, Arc<ResolvedConfig>, Vec<Box<[u8]>>)>>,
    contexts: crate::svelte_context::Contexts,
    /// `bun lint --run-eslint-tests --svelte-plugin=<module>`: the eslint-plugin-svelte module to use where a config
    /// has none. The cases of rules that compile a component were recorded with its `svelte/compiler`.
    plugin_for_tests: Option<Vec<u8>>,
    /// Each component's typed program outcome, by path and then by text. See [`Context::typed_of`].
    typed_programs:
        Guarded<bun_sema::util::FxHashMap<Vec<u8>, Vec<(Vec<u8>, Option<Arc<TypedOutcome>>)>>>,
}

impl Shared {
    /// The outcome [`Context::typed_of`] found for the component `text` at `path`, if it has looked.
    fn typed_found(&self, path: &[u8], text: &[u8]) -> Option<Option<Arc<TypedOutcome>>> {
        let all = self.typed_programs.lock();
        let texts = all.get(path)?;
        texts.iter().find(|it| it.0 == text).map(|it| it.1.clone())
    }

    fn note_typed(&self, path: &[u8], text: &[u8], outcome: Option<Arc<TypedOutcome>>) {
        let mut all = self.typed_programs.lock();
        let texts = all.entry(path.to_vec()).or_default();
        if !texts.iter().any(|it| it.0 == text) {
            texts.push((text.to_vec(), outcome));
        }
    }
}

/// The rules that are on for components, or that a component's comment turns on, and that only ESLint runs on them:
/// JavaScript plugin rules, and the native rules that need types, which a component's program doesn't have. If ESLint
/// runs one of them on a component, it runs every JavaScript plugin rule there, because it creates all rules before
/// calling any listener.
pub(crate) struct Residual {
    /// Their names, sorted.
    names: Vec<Box<[u8]>>,
    /// True if one of them reads types or [may](may_read_types), so ESLint's parser has to create a TypeScript program
    /// for them.
    pub(crate) is_typed: bool,
}

impl Residual {
    /// The residual for the components `config` applies to, if it has such rules. It excludes the eslint-plugin-svelte
    /// rules that are [native](native_for), and includes the ones that [run in the host](runs_in_host) only alongside
    /// another one.
    pub(crate) fn of(config: &ResolvedConfig) -> Option<Residual> {
        let of = Residual::with(config, true)?;
        Some(Residual::with_hosted(Some(&of), config))
    }

    /// `of`, plus the rules that [run in the host](runs_in_host) on the components of `config`: when ESLint runs one
    /// rule on a component, it runs all of them.
    pub(crate) fn with_hosted(of: Option<&Residual>, config: &ResolvedConfig) -> Residual {
        Residual::and(of, config, hosted_in(config).map(|it| &it.configured.rule))
    }

    /// The residual for the `.svelte.js` and `.svelte.ts` files `config` applies to: the JavaScript plugin rules, which
    /// get what only svelte-eslint-parser provides. The native rules run on the native program, which has types where
    /// the config asks for them.
    pub(crate) fn for_script(config: &ResolvedConfig) -> Option<Residual> {
        Residual::with(config, false)
    }

    /// With `for_components`, the native rules that need types are included and the native eslint-plugin-svelte rules
    /// aren't.
    fn with(config: &ResolvedConfig, for_components: bool) -> Option<Residual> {
        let mut on = (config.js_rules.iter()).filter(|it| {
            let rule = &it.configured.rule;
            it.severity != Severity::Off
                && !(for_components
                    && (native_for(config, rule).is_some() || runs_in_host(config, rule)))
        });
        let mut names: Vec<Box<[u8]>> =
            on.clone().map(|it| it.configured.rule.id.clone()).collect();
        let typed_here = (config.configured())
            .filter(|_| for_components)
            .filter(|it| it.severity != Severity::Off && it.entry.meta.requires_types)
            .map(|it| match it.name() {
                Some(name) => Box::from(&name[..]),
                None => RuleId::Known(it.entry.meta).to_vec().into_boxed_slice(),
            })
            .collect::<Vec<_>>();
        let is_typed =
            !typed_here.is_empty() || on.any(|it| may_read_types(config, &it.configured.rule));
        names.extend(typed_here);
        if names.is_empty() {
            return None;
        }
        sort::sort_unstable(&mut names);
        names.dedup();
        Some(Residual { names, is_typed })
    }

    /// The names, for ESLint's `ruleFilter`.
    pub(crate) fn names(&self) -> &[Box<[u8]>] {
        &self.names
    }

    /// `of`, plus the eslint-plugin-svelte rules that are on in `config` and that the native rules which [run where
    /// types are](bun_lint::rule::Meta::runs_where_types_are) replace. ESLint runs them on a component whose typed
    /// program is [rejected](TypedOutcome::Refused).
    fn with_typed(of: Option<Arc<Residual>>, config: &ResolvedConfig) -> Option<Arc<Residual>> {
        let typed = (config.js_rules.iter()).filter(|it| {
            let native = native_for(config, &it.configured.rule);
            it.severity != Severity::Off && native.is_some_and(|it| it.meta.runs_where_types_are())
        });
        let mut names: Vec<Box<[u8]>> = typed.map(|it| it.configured.rule.id.clone()).collect();
        if names.is_empty() {
            return of;
        }
        names.extend(of.iter().flat_map(|it| it.names.iter().cloned()));
        sort::sort_unstable(&mut names);
        names.dedup();
        Some(Arc::new(Residual {
            names,
            is_typed: true,
        }))
    }

    fn has(&self, name: &[u8]) -> bool {
        self.names.binary_search_by(|it| (**it).cmp(name)).is_ok()
    }

    /// `of`, the residual of `config`, plus the JavaScript plugin rules that are off there and that a comment in `text`
    /// turns on, because ESLint runs those on the file too. `allows` is true if comments can configure rules (no
    /// `--no-inline-config`). For `for_components`, see [`Residual::with`].
    fn with_comment_rules(
        of: Option<Arc<Residual>>,
        config: &ResolvedConfig,
        text: &[u8],
        (allows, for_components): (bool, bool),
    ) -> Option<Arc<Residual>> {
        if !allows || config.linter.no_inline_config {
            return of;
        }
        let turned_on = bun_lint::linter::rules_turned_on_in_comments(text);
        let mut added = (turned_on.iter())
            .filter_map(|id| config.find_js_rule(id).flatten())
            .filter(|rule| of.as_ref().is_none_or(|it| !it.has(&rule.id)))
            .filter(|rule| !(for_components && native_for(config, rule).is_some()))
            .peekable();
        if added.peek().is_none() {
            return of;
        }
        Some(Arc::new(Residual::and(of.as_deref(), config, added)))
    }

    /// `of`, plus `rules` from `config`'s JavaScript plugins, which ESLint runs too.
    pub(crate) fn and<'r>(
        of: Option<&Residual>,
        config: &ResolvedConfig,
        rules: impl IntoIterator<Item = &'r Arc<js_plugin::Rule>>,
    ) -> Residual {
        let mut residual = Residual {
            names: of.map(|it| it.names.clone()).unwrap_or_default(),
            is_typed: of.is_some_and(|it| it.is_typed),
        };
        for rule in rules {
            residual.is_typed |= may_read_types(config, rule);
            residual.names.push(rule.id.clone());
        }
        sort::sort_unstable(&mut residual.names);
        residual.names.dedup();
        residual
    }
}

/// True if the residual of `target`, a natively linted component or a [script](is_script), is typed only because of the
/// rules that comments in its text turn on, so it's linted along with the typed residuals. The file is only read if its
/// configured residual isn't typed and such a comment could make it typed. `allows` is true if comments can configure
/// rules.
pub(crate) fn is_typed_by_comments(target: &Target, allows: bool) -> bool {
    let Status::Matched(config) = &target.status else {
        return false;
    };
    let is_component = is_native(&target.path, config);
    let configured = match is_component {
        true => Residual::of(config),
        false if is_script(&target.path, config) => Residual::for_script(config),
        false => return false,
    };
    if configured.is_some_and(|it| it.is_typed)
        || !config.language.wants_types
        || config.js_plugins.is_empty()
    {
        return false;
    }
    let Ok(text) = crate::fs::read(&target.path) else {
        return false;
    };
    Residual::with_comment_rules(None, config, &text, (allows, is_component))
        .is_some_and(|it| it.is_typed)
}

/// True if a JavaScript plugin rule may read types from typescript-eslint's parser services when `config` has ESLint's
/// parser create a TypeScript program, so its residual needs one. The metadata doesn't say: eslint-plugin-svelte sets
/// `requiresTypeChecking: false` on rules that read types when they're available. Only for that package's rules, under
/// whatever name the config gives it, is it known which ones don't.
fn may_read_types(config: &ResolvedConfig, rule: &Arc<js_plugin::Rule>) -> bool {
    if !config.language.wants_types {
        return false;
    }
    match name_in_svelte_plugin(config, rule) {
        Some(name) => TYPED.iter().any(|it| it.as_bytes() == name),
        None => true,
    }
}

/// eslint-plugin-svelte's name for `rule`, if it's one of that package's rules, whatever name the config gives the
/// package.
fn name_in_svelte_plugin<'r>(
    config: &ResolvedConfig,
    rule: &'r Arc<js_plugin::Rule>,
) -> Option<&'r [u8]> {
    let plugin = (config.js_plugins.iter())
        .find(|it| (it.rules.iter()).any(|other| Arc::ptr_eq(other, rule)))?;
    plugin
        .module
        .as_deref()
        .filter(|it| is_svelte_plugin_module(it))?;
    let skipped = plugin.name.len() + usize::from(!plugin.name.is_empty());
    rule.id.get(skipped..)
}

/// True if `rule`, a JavaScript plugin rule, runs in the native plugin host on natively linted components, on the
/// svelte-eslint-parser tree that `bun_lint::estree` builds from the component and its program. That's any rule not
/// from eslint-plugin-svelte, which reads things only svelte-eslint-parser has. It only applies where ESLint runs no
/// rule on the component: if it runs one ([`Context::component_residual`]), or a hosted rule asks for parser
/// services ([`NeedsServices`]), ESLint runs all of them on that component.
fn runs_in_host(config: &ResolvedConfig, rule: &Arc<js_plugin::Rule>) -> bool {
    name_in_svelte_plugin(config, rule).is_none()
}

/// The rules that are on for the components of `config` and [run in the host](runs_in_host), in config order.
fn hosted_in(config: &ResolvedConfig) -> impl Iterator<Item = &ConfiguredJsRule> {
    (config.js_rules.iter())
        .filter(|it| it.severity != Severity::Off && runs_in_host(config, &it.configured.rule))
}

/// True if a rule that's on for the components of `config` [runs in the host](runs_in_host).
pub(crate) fn has_hosted_rules(config: &ResolvedConfig) -> bool {
    hosted_in(config).next().is_some()
}

/// The native rule that replaces `rule` on natively linted components, if `rule` is an eslint-plugin-svelte rule with a
/// native port. The native rule runs on the component, and ESLint doesn't run `rule`.
fn native_for(config: &ResolvedConfig, rule: &Arc<js_plugin::Rule>) -> Option<&'static RuleEntry> {
    let name = name_in_svelte_plugin(config, rule)?;
    bun_lint_svelte::RULES
        .iter()
        .find(|it| it.meta.name.as_bytes() == name)
}

/// True if a native rule replaces `rule` on the natively linted components of `config`.
pub(crate) fn is_answered_here(config: &ResolvedConfig, rule: &Arc<js_plugin::Rule>) -> bool {
    native_for(config, rule).is_some()
}

/// The id of the first eslint-plugin-svelte rule that `config` turns on, in config order. ESLint creates it first, and
/// each of them requests the file's Svelte context.
fn first_svelte_rule(config: &ResolvedConfig) -> Option<Vec<u8>> {
    config.entries().find_map(|it| match it {
        Entry::Js(rule) if name_in_svelte_plugin(config, &rule.configured.rule).is_some() => {
            created_by_eslint(&it)
        }
        Entry::Native(rule) if rule.entry.meta.plugin == Plugin::Svelte => created_by_eslint(&it),
        _ => None,
    })
}

/// The id of `entry`'s rule, if it's on, because then ESLint creates it.
fn created_by_eslint(entry: &Entry<'_>) -> Option<Vec<u8>> {
    match entry {
        Entry::Js(rule) if rule.severity != Severity::Off => Some(rule.configured.rule.id.to_vec()),
        Entry::Native(rule) if rule.severity != Severity::Off => Some(match rule.name() {
            Some(name) => name.to_vec(),
            None => RuleId::Known(rule.reported_as()).to_vec(),
        }),
        _ => None,
    }
}

/// True if ESLint creates the rule `thrower`, which threw while being created, before the rule `rule`. It creates them
/// in `config` order, and the first one that throws is the file's error. A throw after every rule is set up (`None`),
/// while parsing selectors or calling listeners, comes after all of that.
fn is_created_before(config: &ResolvedConfig, thrower: Option<&[u8]>, rule: &[u8]) -> bool {
    let Some(thrower) = thrower else {
        return false;
    };
    let mut made = config.entries().filter_map(|it| created_by_eslint(&it));
    made.find(|it| it == thrower || it == rule)
        .is_some_and(|it| it == thrower && it != rule)
}

/// The rule ESLint was setting up when it threw the error in `linted`, if any. `None` if every rule was already set up.
fn thrower(linted: &LintResult) -> Option<&[u8]> {
    match &linted.thrown_while {
        Some(ThrownWhile::SettingUp(rule)) => Some(rule),
        Some(ThrownWhile::AfterSetUp) => None,
        // The worker traces no rule for ESLint before 9.24: this is what its `Linter` says about a rule that fails to
        // load.
        None => {
            let said = (linted.thrown.as_deref()?).strip_prefix(b"Error while loading rule '")?;
            strings::index_of(said, b"': ").and_then(|end| said.get(..end))
        }
    }
}

/// The rules in `hosted`, which are in `config` order, that ESLint creates before the rule `rule`.
fn created_before<'r>(
    config: &ResolvedConfig,
    hosted: &[&'r ConfiguredJsRule],
    rule: &[u8],
) -> Vec<&'r ConfiguredJsRule> {
    let earlier: Vec<Vec<u8>> = (config.entries().filter_map(|it| created_by_eslint(&it)))
        .take_while(|it| it != rule)
        .collect();
    (hosted.iter().copied())
        .filter(|it| earlier.iter().any(|id| id[..] == it.configured.rule.id[..]))
        .collect()
}

/// True if the module at `path` is part of the eslint-plugin-svelte package.
pub(crate) fn is_svelte_plugin_module(path: &[u8]) -> bool {
    let path = paths::from_native(path);
    let package = strings::last_index_of(&path, b"/node_modules/").and_then(|at| path.get(at..));
    package.is_some_and(|it| it.starts_with(b"/node_modules/eslint-plugin-svelte/"))
}

/// The eslint-plugin-svelte rules that read types from typescript-eslint's parser services.
const TYPED: &[&str] = &[
    "no-unused-props",
    "require-store-reactive-access",
    "no-navigation-without-resolve",
    "require-event-prefix",
    "@typescript-eslint/no-unnecessary-condition",
];

struct Derived {
    base: Arc<ResolvedConfig>,
    is_typescript: bool,
    runes: bool,
    config: Arc<ResolvedConfig>,
}

impl Shared {
    /// For `--run-eslint-tests`, with [`Shared::plugin_for_tests`].
    pub(crate) fn for_tests(plugin_for_tests: Option<Vec<u8>>) -> Shared {
        Shared {
            plugin_for_tests,
            ..Shared::default()
        }
    }

    /// `base`, a component config, with the [native rules](native_for) replacing the eslint-plugin-svelte rules they
    /// port, and the names of the ones it configures. The ones it doesn't configure are included too, turned off, under
    /// every name a plugin from that package gives them, so a comment can turn them on. Returns `base` itself if it has
    /// none.
    fn with_natives(&self, base: &Arc<ResolvedConfig>) -> (Arc<ResolvedConfig>, Vec<Box<[u8]>>) {
        let mut all = self.with_natives.lock();
        if let Some(found) = all.iter().find(|it| Arc::ptr_eq(&it.0, base)) {
            return (Arc::clone(&found.1), found.2.clone());
        }
        let answered: Vec<(Arc<js_plugin::Rule>, &'static RuleEntry)> = (base.js_rules.iter())
            .filter_map(|it| {
                let rule = &it.configured.rule;
                Some((Arc::clone(rule), native_for(base, rule)?))
            })
            .collect();
        let is_answered =
            |rule: &Arc<js_plugin::Rule>| answered.iter().any(|it| Arc::ptr_eq(&it.0, rule));
        let unconfigured: Vec<(Arc<js_plugin::Rule>, &'static RuleEntry)> =
            (base.js_plugins.iter())
                .flat_map(|plugin| plugin.rules.iter())
                .filter(|rule| !is_answered(rule))
                .filter_map(|rule| Some((Arc::clone(rule), native_for(base, rule)?)))
                .collect();
        let config = match answered.is_empty() && unconfigured.is_empty() {
            true => Arc::clone(base),
            false => {
                let mut config = (**base).clone();
                for (rule, entry) in &answered {
                    config.answer_for(rule, entry);
                }
                for (rule, entry) in &unconfigured {
                    config.answer_for_unconfigured(rule.id[..].into(), entry);
                }
                Arc::new(config)
            }
        };
        let mut names: Vec<Box<[u8]>> = answered.iter().map(|it| it.0.id.clone()).collect();
        sort::sort_unstable(&mut names);
        all.push((Arc::clone(base), Arc::clone(&config), names.clone()));
        (config, names)
    }

    /// [`Residual::of`] for the components that `config` applies to.
    fn residual_of(&self, config: &Arc<ResolvedConfig>) -> Option<Arc<Residual>> {
        let mut all = self.residuals.lock();
        if let Some(found) = all.iter().find(|it| Arc::ptr_eq(&it.0, config)) {
            return found.1.clone();
        }
        let residual = Residual::of(config).map(Arc::new);
        all.push((Arc::clone(config), residual.clone()));
        residual
    }

    /// [`Residual::for_script`] for the files that `config`, from [`Shared::config_for_script`], applies to.
    fn script_residual(&self, config: &Arc<ResolvedConfig>) -> Option<Arc<Residual>> {
        let mut all = self.script_residuals.lock();
        if let Some(found) = all.iter().find(|it| Arc::ptr_eq(&it.0, config)) {
            return found.1.clone();
        }
        let residual = Residual::for_script(config).map(Arc::new);
        all.push((Arc::clone(config), residual.clone()));
        residual
    }

    /// The config of the file at `path` if it [is a script](is_script), with the runes added as globals the way
    /// svelte-eslint-parser adds them there (`parseAsScript`), because Svelte 5 is always in runes mode in such files.
    pub(crate) fn config_for_script(
        &self,
        path: &[u8],
        base: &Arc<ResolvedConfig>,
    ) -> Option<Arc<ResolvedConfig>> {
        if !is_script(path, base) {
            return None;
        }
        let mut scripts = self.scripts.lock();
        if let Some(found) = scripts.iter().find(|it| Arc::ptr_eq(&it.0, base)) {
            return Some(Arc::clone(&found.1));
        }
        let config = Arc::new(with_globals(base, &RUNES));
        scripts.push((Arc::clone(base), Arc::clone(&config)));
        Some(config)
    }

    /// The config for the program of a component whose config is `base`: the parser that svelte-eslint-parser passes
    /// the scripts to, and the globals it adds.
    fn config_for(
        &self,
        base: &Arc<ResolvedConfig>,
        is_typescript: bool,
        runes: bool,
    ) -> Arc<ResolvedConfig> {
        let mut configs = self.configs.lock();
        let found = configs.iter().find(|it| {
            Arc::ptr_eq(&it.base, base) && it.is_typescript == is_typescript && it.runes == runes
        });
        if let Some(found) = found {
            return Arc::clone(&found.config);
        }
        let runes_too: &[&str] = if runes { &RUNES } else { &[] };
        let globals: Vec<&str> = SVELTE_GLOBALS.iter().chain(runes_too).copied().collect();
        let mut config = with_globals(base, &globals);
        config.language.parser = match is_typescript {
            true => Parser::TypeScript,
            false => Parser::Espree,
        };
        // `normalizeParserOptions`, whatever `sourceType` says.
        config.language.parser_source_type = Some(SourceType::Module);
        config.language.set_source_type(SourceType::Module);
        let config = Arc::new(config);
        configs.push(Derived {
            base: Arc::clone(base),
            is_typescript,
            runes,
            config: Arc::clone(&config),
        });
        config
    }
}

/// `base` with `names` added as read-only globals, unless it already has them.
fn with_globals(base: &ResolvedConfig, names: &[&str]) -> ResolvedConfig {
    let mut config = base.clone();
    let mut globals = (*config.language.globals).clone();
    for name in names.iter().map(|it| it.as_bytes()) {
        if let Err(at) = globals.binary_search_by(|it| (*it.0).cmp(name)) {
            globals.insert(at, (name.into(), Global::Readonly));
            Arc::make_mut(&mut config.language.global_order).push(name.into());
        }
    }
    config.language.globals = Arc::new(globals);
    config.language.config_globals = OnceLock::new();
    config
}

/// How the run handles a file: `None` if it isn't a component for svelte-eslint-parser, otherwise true if it's linted
/// natively. That's only with eslint-plugin-svelte's processor or none, and without [unknown runes](has_unknown_runes).
pub(crate) fn route(path: &[u8], config: &ResolvedConfig) -> Option<bool> {
    if !path.ends_with(b".svelte") || !is_read_by_svelte_parser(config) {
        return None;
    }
    let language = config.language_name.as_deref();
    Some(
        (config.processor.is_none() || processes_here(config))
            && language.is_none_or(|it| matches!(it, b"@/js" | b"js/js"))
            && !has_unknown_runes(&config.language.parser_options),
    )
}

/// True if `parserOptions.svelteConfig`'s `compilerOptions.runes` isn't a JSON value but a function that
/// svelte-eslint-parser calls for each component (`isRunesAsParseContext`), and `svelteFeatures.runes` doesn't decide
/// first. Its answer isn't known here, so ESLint lints the component.
fn has_unknown_runes(options: &Json) -> bool {
    let features = (options.get(b"svelteFeatures")).and_then(|it| it.get(b"runes"));
    if features.is_some_and(|it| *it != Json::Null) {
        return false;
    }
    let config = options.get(b"svelteConfig").filter(|it| it.is_truthy());
    let runes = (config.and_then(|it| it.get(b"compilerOptions"))).and_then(|it| it.get(b"runes"));
    runes.is_some_and(|it| it.get(b"$unserializable").is_some())
}

/// True if eslint-plugin-svelte's processor is configured for the components of `config`, whatever name the config
/// gives the plugin. Then it runs natively instead of in ESLint: the native rules leave it what the HTML comments and
/// `settings.svelte.ignoreWarnings` disable, and it removes that from all reports ([`shared::Shared`]).
pub(crate) fn processes_here(config: &ResolvedConfig) -> bool {
    let named_plugin = config
        .processor_location
        .as_ref()
        .and_then(|it| it.named_plugin.as_ref());
    named_plugin.is_some_and(|(module, name)| {
        matches!(&name[..], b"svelte" | b".svelte")
            && module.as_deref().is_some_and(is_svelte_plugin_module)
    })
}

/// True if the file at `path` is a `.svelte.js` or `.svelte.ts` file that svelte-eslint-parser reads, and it's linted
/// natively.
pub(crate) fn is_script(path: &[u8], config: &ResolvedConfig) -> bool {
    (path.ends_with(b".svelte.js") || path.ends_with(b".svelte.ts"))
        && is_read_by_svelte_parser(config)
}

/// True if svelte-eslint-parser reads the files of `config`.
fn is_read_by_svelte_parser(config: &ResolvedConfig) -> bool {
    let is_named = (config.parser_name.as_deref())
        .is_some_and(|it| without_version(it) == b"svelte-eslint-parser");
    // A parser without a name is identified by its module.
    let is_located = (config.parser_module.as_deref()).is_some_and(|it| {
        let it = paths::from_native(it);
        strings::contains(&it, b"/svelte-eslint-parser/")
    });
    (is_named || is_located) && !config.language.is_oxlint
}

/// True if the file is linted natively as a component.
pub(crate) fn is_native(path: &[u8], config: &ResolvedConfig) -> bool {
    route(path, config) == Some(true)
}

/// True if the blocks of the component `text` are read here the same way svelte-eslint-parser and Svelte read them.
/// Otherwise ESLint lints it: see [`Parsed::is_reproduced`]. Also excluded: a top-level script (for Svelte) that
/// svelte-eslint-parser leaves in the markup because its start tag can't start there (`isValidStartTagOpenIndex`), a
/// top-level script or style with a mustache in its start tag, which svelte-eslint-parser may fail on, and a nested one
/// with a `{` in a start tag value, which Svelte parses (`read_sequence`).
pub(crate) fn is_reproduced(text: &[u8]) -> bool {
    let parsed = as_parsed(text);
    if !parsed.is_reproduced {
        return false;
    }
    let is_read_alike = parsed.with_mustaches.is_empty() && parsed.with_braces.is_empty();
    if !parsed.may_leave_a_script && is_read_alike {
        return true;
    }
    let tree = bun_format::svelte::parse_tree(
        &parsed.text,
        crate::fmt::parse_parts,
        crate::fmt::parse_javascript,
    );
    // Svelte rejects the component both here and there, unless svelte-eslint-parser or a start tag value fails first.
    let Ok(tree) = tree else {
        return is_read_alike;
    };
    let blocks = top_level_scripts(&tree).into_iter().chain(tree.css);
    let at_the_top: Vec<usize> = blocks.map(|it| tree[it].start as usize).collect();
    if (at_the_top.iter()).any(|it| parsed.with_mustaches.contains(it))
        || (parsed.with_braces.iter()).any(|it| !at_the_top.contains(it))
    {
        return false;
    }
    top_level_scripts(&tree).into_iter().all(|it| {
        let content = match &tree[it].kind {
            Kind::Script { content, .. } => (content.start as usize, content.end as usize),
            _ => return true,
        };
        parsed.scripts.contains(&content)
    })
}

/// `name@version`, the way a config names a parser object, without the version.
fn without_version(name: &[u8]) -> &[u8] {
    match strings::last_index_of_char(name, b'@') {
        Some(at) if at > 0 => &name[..at],
        _ => name,
    }
}

impl Context<'_, '_> {
    /// The residual of the component `text` at `path`, plus the rules whose typed program was rejected and the ones a
    /// comment in `text` turns on. If it has any, or if a comment configures a hosted rule with its own options or
    /// severity, ESLint also runs every rule that would [run in the host](runs_in_host). Nothing learned from another
    /// file about a rule counts here, so a component's route doesn't depend on file order.
    pub(crate) fn component_residual(
        &self,
        config: &Arc<ResolvedConfig>,
        text: &[u8],
        path: &[u8],
    ) -> Option<Arc<Residual>> {
        let of = self.svelte.residual_of(config);
        let of = Residual::with_comment_rules(of, config, text, (self.options.inline_config, true));
        let of = match self.typed_of(path, text, config).as_deref() {
            Some(TypedOutcome::Refused) => Residual::with_typed(of, config),
            _ => of,
        };
        match of {
            Some(of) if hosted_in(config).all(|it| of.has(&it.configured.rule.id)) => Some(of),
            None if !self.configures_hosted_rules(config, text) => None,
            of => Some(Arc::new(Residual::with_hosted(of.as_deref(), config))),
        }
    }

    /// True if a comment in `text` configures a rule that's on for the components of `config` and runs in the host.
    fn configures_hosted_rules(&self, config: &ResolvedConfig, text: &[u8]) -> bool {
        if !self.options.inline_config
            || config.linter.no_inline_config
            || !has_hosted_rules(config)
        {
            return false;
        }
        let configured = bun_lint::linter::rules_configured_in_comments(text);
        let configured: Vec<&Arc<js_plugin::Rule>> = (configured.iter())
            .filter_map(|id| config.find_js_rule(id).flatten())
            .collect();
        hosted_in(config)
            .any(|it| (configured.iter()).any(|rule| Arc::ptr_eq(rule, &it.configured.rule)))
    }

    /// The rules that [run in the host](runs_in_host) on a component with `config` when ESLint runs none, minus the
    /// ones the run's options filter out.
    fn hosted_rules<'c>(&self, config: &'c ResolvedConfig) -> Vec<&'c ConfiguredJsRule> {
        let filter = self.lint_options().rule_filter;
        let is_run = |it: &&ConfiguredJsRule| {
            filter.is_none_or(|filter| {
                filter(&RuleId::Js(Arc::clone(&it.configured.rule)), it.severity)
            })
        };
        hosted_in(config).filter(is_run).collect()
    }

    /// Same for the `.svelte.js` or `.svelte.ts` file `text`, with `config` from [`Shared::config_for_script`].
    fn script_residual(&self, config: &Arc<ResolvedConfig>, text: &[u8]) -> Option<Arc<Residual>> {
        let of = self.svelte.script_residual(config);
        Residual::with_comment_rules(of, config, text, (self.options.inline_config, false))
    }

    /// ESLint's `verifyText` for `text`, the component at `path` that [`route`] assigns to this side. `shown` is what's
    /// printed. ESLint's own `Linter` runs the [rules that only it runs](Residual) on it, and its `processor` too if
    /// there is one, or all its rules if Svelte rejects the component differently from here, in which case it counts as
    /// handed off. `None` if the component [needs `eslint`](Context::needs_eslint).
    pub(crate) fn lint_component(
        &self,
        loaded: &Arc<Loaded>,
        (shown, path): (Vec<u8>, &[u8]),
        text: Vec<u8>,
        config: &Arc<ResolvedConfig>,
        on_circular_fixes: &dyn Fn(&[u8]),
    ) -> Option<FileResult> {
        let residual = self.component_residual(config, &text, path);
        // The residual can't run without ESLint, so the component is handled like any file that needs `eslint`.
        if residual.is_some() && loaded.for_eslint.is_none() {
            return self.verify_processed_text(
                loaded,
                shown,
                path,
                text,
                config,
                on_circular_fixes,
            );
        }
        let mut result = self.verify_text_by(
            shown,
            path,
            (text, false),
            config,
            on_circular_fixes,
            // A fix can change what the comments turn on.
            &mut |text, _| {
                let residual = self.component_residual(config, text, path);
                self.verify_component_with(loaded, path, text, config, residual.as_deref(), None)
            },
        );
        if let Some(linted) = &mut result.linted {
            linted.loaded = Some(Arc::clone(loaded));
        }
        Some(result)
    }

    /// ESLint's `verifyText` for `text`, the file at `path` that [is a script](is_script), with `config` from
    /// [`Shared::config_for_script`]. `shown` is what's printed. The native program stands in for
    /// svelte-eslint-parser's, and the native rules run on it. ESLint's own `Linter` runs the [rules that only it
    /// runs](Residual::for_script) with svelte-eslint-parser, and their messages are merged with the native ones before
    /// the file's comments are applied. `None` if the file [needs `eslint`](Context::needs_eslint).
    pub(crate) fn lint_script(
        &self,
        loaded: &Loaded,
        (shown, path): (Vec<u8>, &[u8]),
        text: Vec<u8>,
        config: &Arc<ResolvedConfig>,
        on_circular_fixes: &dyn Fn(&[u8]),
    ) -> Option<FileResult> {
        let residual = (self.script_residual(config, &text)).filter(|_| {
            loaded.for_eslint.is_some() && loaded.routes(config, path) == Route::Native
        });
        let Some(first) = residual else {
            return self.verify_processed_text(
                loaded,
                shown,
                path,
                text,
                config,
                on_circular_fixes,
            );
        };
        Some(self.verify_text_by(
            shown,
            path,
            (text, false),
            config,
            on_circular_fixes,
            // A fix can change what the comments turn on. If it turns off something they turned on, ESLint leaves it
            // off.
            &mut |text, _| {
                let residual = self.script_residual(config, text);
                let residual = residual.as_ref().unwrap_or(&first);
                self.verify_script_with(loaded, path, text, config, residual)
            },
        ))
    }

    /// Lints `text` as the component at `path` with the native rules. For `again`, see [`LintOptions::again`], with
    /// positions in the component. `residual` holds the rules that only ESLint runs on components, plus the ones that
    /// would run in the host ([`Residual::with_hosted`]), and the function that lints `text` with them. Its messages
    /// are merged with the native rules' before the file's comments are applied ([`LintOptions::residual`]). Without
    /// it, the JavaScript plugin rules run in the host. `hand_off` lints `text` in ESLint with all its rules, used if
    /// Svelte rejects it with a different message or position than here ([`svelte_text`]), or doesn't reject it at all.
    /// Without it, the native error is reported. If eslint-plugin-svelte's processor is configured
    /// ([`processes_here`]), it removes what the HTML comments and `settings.svelte.ignoreWarnings` disable once the
    /// program's comments are applied. [`NeedsServices`] only happens with `hand_off` and without `residual`: then
    /// ESLint is available to run the hosted rules, and hasn't run anything yet.
    ///
    /// [`LintOptions::again`]: bun_lint::linter::LintOptions::again
    /// [`LintOptions::residual`]: bun_lint::linter::LintOptions::residual
    pub(crate) fn verify_component(
        &self,
        path: &[u8],
        text: &[u8],
        base: &Arc<ResolvedConfig>,
        again: Option<Again<'_>>,
        residual: Option<(&Residual, &dyn Fn(&[u8]) -> LintResult)>,
        hand_off: Option<&dyn Fn(&[u8]) -> LintResult>,
    ) -> Result<LintResult, NeedsServices> {
        let ran = residual.map(|it| it.0);
        // svelte-eslint-parser reads the Svelte config before the component.
        let contexts = &self.svelte.contexts;
        let svelte_config = contexts.svelte_config(path, &base.language.parser_options, self.cwd);
        let svelte_config = match svelte_config {
            Ok(config) => config,
            Err(fatal) => {
                return Ok(LintResult {
                    messages: vec![*fatal],
                    ..LintResult::default()
                });
            }
        };
        // What ESLint throws when it creates the rules, after the component is parsed.
        let fails_to_load = (contexts.has_kit_routes_error(path, base, &svelte_config, self.cwd))
            .then(|| first_svelte_rule(base))
            .flatten()
            .map(|rule| {
                let thrown =
                    b"((intermediate value) ?? (intermediate value))?.replace is not a function";
                let path = paths::resolve(self.cwd, path);
                let said = [&b"Error while loading rule '"[..], &rule, b"': ", thrown];
                let message = [&said.concat()[..], b"\nOccurred while linting ", &path].concat();
                (rule, message)
            });
        let places = Places::new(text);
        let parsed = as_parsed(text);
        let tree = bun_format::svelte::parse_tree(
            &parsed.text,
            crate::fmt::parse_parts,
            crate::fmt::parse_javascript,
        );
        let tree = match tree {
            Ok(tree) => tree,
            Err(None) => return Ok(nested_too_deeply()),
            Err(Some(SyntaxError(message, at))) => {
                return Ok(match (svelte_text(message, at, text), hand_off) {
                    (Some((said, at)), _) => refused_at(&places, &said, at),
                    (None, Some(lint)) => lint(text),
                    (None, None) => refused_at(&places, message.text().as_bytes(), at),
                });
            }
        };
        let dialect = Dialect::of(
            (&tree, parsed.lang),
            (text, &svelte_config),
            &base.language,
            &base.parser_names,
        );
        if dialect.is_handed_off
            && let Some(lint) = hand_off
        {
            return Ok(lint(text));
        }
        // ESLint runs either all JavaScript plugin rules on the component or none, in which case they run in the host.
        let hosted = match ran {
            Some(_) => Vec::new(),
            None => self.hosted_rules(base),
        };
        let settings = base.js_settings.as_deref();
        // ESLint reports nothing else for a file its parser rejects.
        let residual = match residual.map(|(_, lint)| lint(text)) {
            Some(linted) if linted.messages.iter().any(|it| it.is_fatal) => return Ok(linted),
            linted => linted,
        };
        let is_thrown_by_residual = residual.as_ref().is_some_and(|it| it.thrown.is_some());
        // ESLint creates the rules in config order before calling any listener, and the first one that throws while
        // being created fails the file. That's the residual's error, unless a native rule that fails to load is created
        // before the one the residual was setting up.
        if let Some(linted) = residual.as_ref().filter(|it| it.thrown.is_some())
            && (fails_to_load.as_ref())
                .is_none_or(|(rule, _)| is_created_before(base, thrower(linted), rule))
        {
            return Ok(residual.unwrap_or_default());
        }
        let names = self.component_residual(base, text, path);
        // When the file is linted again, those rules already ran the first time.
        let typed = again
            .is_none()
            .then(|| self.typed_of(path, text, base))
            .flatten();
        let thrown_as = (&**base, path);
        let (base, _) = self.svelte.with_natives(base);
        let Some(mut summary) = summarize(text, &parsed.text, &tree, generics_of(&tree, &dialect))
        else {
            return Ok(nested_too_deeply());
        };
        let runes = (&*svelte_config, dialect.configured_runes);
        (summary.component).set_context(contexts.context_of(path, &base, runes, self.cwd));
        let config = self
            .svelte
            .config_for(&base, dialect.is_typescript, dialect.runes);
        let kind = match dialect.is_typescript {
            true => ScriptKind::Ts,
            false => ScriptKind::Js,
        };
        // If the only script is top-level, it takes every statement, which the program has unchanged.
        let has_scripts = parsed.scripts.len() > top_level_scripts(&tree).len().min(1);
        let processes = processes_here(&base);
        // eslint-plugin-svelte imports `svelte/compiler`, so the copy that the plugin's module resolves is used. Only a
        // config that has loaded the plugin, and so runs the project's JavaScript, compiles a component.
        let filename = paths::resolve(self.cwd, path);
        let plugin = (base.js_plugins.iter())
            .filter_map(|it| it.module.as_deref())
            .find(|it| is_svelte_plugin_module(it))
            .map(<[u8]>::to_vec)
            .or_else(|| self.svelte.plugin_for_tests.clone());
        let experimental_async = (svelte_config.get(b"compilerOptions"))
            .and_then(|it| it.get(b"experimental")?.get(b"async"))
            .map_or_else(
                || b"null".to_vec(),
                |it| {
                    let mut out = Vec::new();
                    bun_lint::linter::write_json(&mut out, it);
                    out
                },
            );
        // Only typescript-eslint's parser creates a program, and it doesn't create its own when `programs` provides
        // them.
        let options = &base.language.parser_options;
        let is_set = |name: &[u8]| options.get(name).is_some_and(Json::is_truthy);
        let program = match dialect.is_typescript
            && !is_set(b"programs")
            && (is_set(b"project") || is_set(b"projectService"))
        {
            true => {
                let names: [&[u8]; 5] = [
                    b"project",
                    b"projectService",
                    b"tsconfigRootDir",
                    b"extraFileExtensions",
                    b"projectFolderIgnoreList",
                ];
                let entries = (names.iter())
                    .filter_map(|&name| Some((name.to_vec(), options.get(name)?.clone())))
                    .collect();
                let mut out = Vec::new();
                Json::object(entries).stringify(&mut out);
                out
            }
            false => b"null".to_vec(),
        };
        let compiler = plugin
            .as_ref()
            .map(|plugin| bun_lint::svelte_compiler::Compiler {
                compiles: self.js_plugins,
                plugin,
                filename: &filename,
                experimental_async: &experimental_async,
                program: &program,
            });
        let mut plan = Plan::default();
        loop {
            let Some(lowered) = lower(text, &parsed, &tree, &dialect, &plan) else {
                return Ok(nested_too_deeply());
            };
            let shared = processes.then(shared::Shared::default);
            let is_synthetic = |span: Span| lowered.is_synthetic(span);
            let view = lowered.view(text, &plan);
            let mut scopes = Lowered::default();
            for &(at, id, of) in &lowered.scope_owners {
                if let Some(owner) = summary.id_of(id, of) {
                    scopes.add_scope(at, owner);
                }
            }
            let component = Component {
                kind,
                is_synthetic: &is_synthetic,
                view: &view,
                svelte: (&summary.component, &scopes),
                shared: shared.as_ref(),
                compiler: compiler.as_ref(),
                has_types_elsewhere: typed.is_some(),
            };
            let as_what = How::component(component, None, None);
            let prepare = |file: &File<'_>| {
                if !self.options.inline_config
                    || config.linter.no_inline_config
                    || config.understands_oxlint_comments
                {
                    file.ignore_config_comments();
                }
            };
            let parse_again = |then: &mut dyn for<'f> FnMut(&'f File<'f>)| {
                self.parse_again_as(path, &lowered.text, &config, &as_what, &mut |file| {
                    prepare(file);
                    then(file);
                });
            };
            let (mut result, mut revised, mut needs_services) = (None, None, None);
            self.parse(path, &lowered.text, &config, &as_what, &mut |file| {
                let Some(file) = file else {
                    result = Some(LintResult {
                        messages: vec![too_deep()],
                        ..LintResult::default()
                    });
                    return;
                };
                // svelte-eslint-parser checks directive names after the program is parsed.
                if parse_error(file).is_none()
                    && let Some((text, at)) = lowered.refusal(file)
                {
                    result = Some(refused_at(&places, &text, at));
                    return;
                }
                if let Some(next) = plan.revised(file, &lowered, &dialect) {
                    revised = Some(next);
                    return;
                }
                let error = parse_error(file);
                let is_parsed = error.is_none();
                let has_markup_code = lowered.has_markup_code();
                // With TypeScript, the render function comes right after the scripts when the markup has no code, and
                // may continue their last line. Before that, svelte-eslint-parser has turned what a `$:` statement does
                // into a function (`analyzeReactiveScopes`), whose `}` ends it.
                let renders = dialect.is_typescript
                    && !has_markup_code
                    && !ends_in_reactive_statement(file, &lowered);
                if has_scripts || (renders && error.is_none()) || crosses_a_script(file, &lowered) {
                    // The program that a statement continuing into the next script produces, where a `;` ends the first
                    // script, isn't a svelte-eslint-parser syntax error.
                    let is_read = error.is_none_or(|it| {
                        let column = it.column.saturating_sub(1);
                        let at = file.offset(Position {
                            line: it.line,
                            column,
                        });
                        (lowered.scripts.iter()).any(|it| it.0.start <= at && at < it.0.end)
                    });
                    let refusal = self.refusal_of_scripts(
                        path,
                        &places,
                        (&parsed, &tree, &dialect),
                        &config,
                        (has_markup_code, is_read, renders),
                    );
                    if let Some(message) = refusal {
                        result = Some(LintResult {
                            messages: vec![message],
                            ..LintResult::default()
                        });
                        return;
                    }
                }
                // If the residual throws, ESLint has parsed the file.
                if (is_parsed || is_thrown_by_residual)
                    && let Some((rule, thrown)) = &fails_to_load
                {
                    // ESLint creates the rules before that rule and runs none of them, so a hosted rule that fails
                    // while being set up is the failure, whatever it throws.
                    let before = created_before(thrown_as.0, &hosted, rule);
                    let earlier = match (again, settings) {
                        (None, Some(settings)) if is_parsed && !before.is_empty() => {
                            prepare(file);
                            let how = (settings, &before[..], hand_off.is_some());
                            match self.run_in_host(file, how, thrown_as, &parse_again, true) {
                                Err(Hosted::Thrown(it)) => Some(it),
                                Err(Hosted::NeedsServices) => {
                                    needs_services = Some(NeedsServices);
                                    return;
                                }
                                _ => None,
                            }
                        }
                        _ => None,
                    };
                    result = Some(LintResult {
                        thrown: Some(earlier.unwrap_or_else(|| thrown.clone())),
                        ..LintResult::default()
                    });
                    return;
                }
                if is_parsed && let Some(TypedOutcome::Thrown(thrown)) = typed.as_deref() {
                    result = Some(LintResult {
                        thrown: Some(thrown.clone()),
                        ..LintResult::default()
                    });
                    return;
                }
                // Reports about the component itself are anchored in the program, to merge with the rules' reports
                // there.
                let into_program = |it: &LintMessage| lowered.anchored(it, file, &places);
                // When the file is linted again, they already ran the first time, and their reports are reused.
                let in_host = match (again, settings) {
                    (None, Some(settings)) if is_parsed && !hosted.is_empty() => {
                        prepare(file);
                        let how = (settings, &hosted[..], hand_off.is_some());
                        match self.run_in_host(file, how, thrown_as, &parse_again, false) {
                            Ok(messages) => Some(messages),
                            Err(Hosted::Thrown(thrown)) => {
                                result = Some(LintResult {
                                    thrown: Some(thrown),
                                    ..LintResult::default()
                                });
                                return;
                            }
                            Err(Hosted::NeedsServices) => {
                                needs_services = Some(NeedsServices);
                                return;
                            }
                        }
                    }
                    _ => None,
                };
                let previous = again.map(|it| LintResult {
                    messages: it.previous.messages.iter().map(into_program).collect(),
                    suppressed: it.previous.suppressed.iter().map(into_program).collect(),
                    processed: it.previous.processed.iter().map(into_program).collect(),
                    ..LintResult::default()
                });
                let mut reported: Option<Vec<LintMessage>> = residual.as_ref().map(|it| {
                    // Comments about the rules that only ESLint runs are applied by the native rules. A message from an
                    // eslint-plugin-svelte rule that ESLint runs in place of a native one is attributed to the native
                    // rule, so comments match it under that name.
                    let has_rule_id = |it: &&LintMessage| it.rule_id.is_some();
                    let all = it.messages.iter().chain(&it.suppressed).filter(has_rule_id);
                    let as_answered = |mut it: LintMessage| {
                        if let Some(RuleId::Js(rule)) = &it.rule_id
                            && let Some(entry) = native_for(thrown_as.0, rule)
                        {
                            it.rule_id = Some(RuleId::Named(entry.meta, rule.id[..].into()));
                        }
                        it
                    };
                    all.map(into_program).map(as_answered).collect()
                });
                if let Some(TypedOutcome::Reports(typed_reports)) = typed.as_deref() {
                    let reported = reported.get_or_insert_with(Vec::new);
                    reported.extend(typed_reports.iter().map(into_program));
                }
                if let Some(in_host) = in_host {
                    let all = reported.get_or_insert_with(Vec::new);
                    all.extend(in_host.iter().map(into_program));
                }
                let again = again.zip(previous.as_ref()).map(|(it, previous)| Again {
                    previous,
                    had_types: it.had_types,
                });
                let is_taken_over = again.is_some() && (names.is_some() || !hosted.is_empty());
                let residual = (reported.as_deref()).or_else(|| is_taken_over.then_some(&[][..]));
                let as_what = How::component(component, again, residual);
                let mut linted = self.verify_parsed(file, &config, &as_what, &parse_again);
                for message in (linted.messages.iter_mut()).chain(&mut linted.suppressed) {
                    lowered.to_original(message, file, &places);
                }
                // They're the program's.
                linted.line_starts = None;
                LintMessage::sort(&mut linted.messages);
                // ESLint runs the processor's `postprocess` on all messages, in order, before it removes what comments
                // suppress.
                if let Some(shared) = &shared {
                    let mut all = std::mem::take(&mut linted.messages);
                    all.append(&mut linted.suppressed);
                    LintMessage::sort(&mut all);
                    let (kept, processed) = shared.filter(all);
                    (linted.suppressed, linted.messages) =
                        kept.into_iter().partition(|it| !it.suppressions.is_empty());
                    linted.processed = processed;
                }
                result = Some(linted);
            });
            match (revised, needs_services) {
                (_, Some(it)) => return Err(it),
                (Some(next), None) => plan = next,
                (None, None) => return Ok(result.unwrap_or_default()),
            }
        }
    }
}

/// A rule that [runs in the host](runs_in_host) has requested parser services on a component that only ESLint provides
/// there. The component is linted again, and ESLint runs all such rules on it ([`Residual::with_hosted`]).
pub(crate) struct NeedsServices;

/// Why [`Context::run_in_host`] has no messages.
enum Hosted {
    /// ESLint throws this for the file.
    Thrown(Vec<u8>),
    /// A rule needs parser services that only ESLint has.
    NeedsServices,
}

impl Context<'_, '_> {
    /// Runs `rules`, which [run in the host](runs_in_host), in the plugin host on the component whose program is
    /// `file`. They see svelte-eslint-parser's tree and scopes. Their reports are in component positions, and so are
    /// their fixes and suggestions, which don't go through the program. `can_move` is true if ESLint can run a rule
    /// that needs parser services the host doesn't provide. Otherwise the service error is reported. `thrown_as` is the
    /// config and path that a rule's throw is reported with. With `only_creates`, the rules are created and none of
    /// their listeners is called.
    fn run_in_host<'f>(
        &self,
        file: &'f File<'f>,
        (settings, rules, can_move): (&js_plugin::FileSettings, &[&ConfiguredJsRule], bool),
        (config, path): (&ResolvedConfig, &[u8]),
        parse_again: &js_plugin::ParseAgain,
        only_creates: bool,
    ) -> Result<Vec<LintMessage>, Hosted> {
        let host = self.js_plugins;
        let enabled: Vec<&js_plugin::Configured> = rules.iter().map(|it| &*it.configured).collect();
        let outcome = match only_creates {
            true => (host.create_on_block(file, settings, &enabled, Some(parse_again)))
                .map(|()| Vec::new()),
            false => host.run_on_block(file, settings, &enabled, true, None, Some(parse_again)),
        };
        let failure = match outcome {
            Ok(reports) => {
                let messages = reports.into_iter().filter_map(|report| {
                    let rule = rules.get(report.rule as usize)?;
                    Some(LintMessage {
                        rule_id: Some(RuleId::Js(Arc::clone(&rule.configured.rule))),
                        severity: rule.severity,
                        message: report.message,
                        message_id: Some(
                            report
                                .message_id
                                .map_or(std::borrow::Cow::Borrowed(""), |id| {
                                    std::borrow::Cow::Owned(id.into())
                                }),
                        ),
                        line: report.line.unwrap_or(0),
                        column: report.column.unwrap_or(0),
                        end: report.end,
                        fix: report.fix,
                        suggestions: report.suggestions.into_iter().map(Into::into).collect(),
                        not_numbers: bun_lint::linter::NotNumbers {
                            line: report.line.is_none(),
                            column: report.column.is_none(),
                        },
                        domain: Domain::Original,
                        reported_on: report.reported_on,
                        ..LintMessage::default()
                    })
                });
                return Ok(messages.collect());
            }
            Err(failure) => failure,
        };
        let at = failure.rule.map(|it| it as usize);
        let rule = at.and_then(|at| rules.get(at).copied());
        if can_move && rule.is_some() && js_plugin::Host::asks_for_parser_services(&failure.message)
        {
            return Err(Hosted::NeedsServices);
        }
        let id = rule.map(|it| &it.configured.rule.id[..]);
        match bun_lint::linter::js_plugin_failure(&failure, id, path, config) {
            Ok(message) => Ok(vec![message]),
            Err(thrown) => Err(Hosted::Thrown(thrown)),
        }
    }

    /// The fatal message for a syntax error that svelte-eslint-parser finds in a component's scripts, which it parses
    /// as one program before the markup. That program has the contents of each top-level script in place, and
    /// whitespace for the rest of the component, with line breaks kept. A script in the markup is whitespace too, but
    /// the whitespace after the last code of all scripts starts after its code. If the markup has code, `\n;` replaces
    /// that whitespace and the markup's code follows. Then each top-level script, in order, takes the statements that
    /// start and end inside it, and the last one takes all that are left. `\n;` is in none of them. A statement that
    /// none takes is "The script is unterminated", unless the component's program has a syntax error, which comes first
    /// (`is_read`). `has_markup_code` is [`Virtual::has_markup_code`]. `renders` is true if the render function follows
    /// right after the scripts (`analyzeRenderScopes`).
    fn refusal_of_scripts(
        &self,
        path: &[u8],
        places: &Places<'_>,
        (parsed, tree, dialect): (&Parsed<'_>, &Tree<'_>, &Dialect),
        config: &ResolvedConfig,
        (has_markup_code, is_read, renders): (bool, bool, bool),
    ) -> Option<LintMessage> {
        let text = places.text;
        let scripts: Vec<(u32, u32)> = (top_level_scripts(tree).into_iter())
            .map(|it| (tree[it].start, tree[it].end))
            .collect();
        let mut program = blanked(text);
        let mut code_end = 0;
        for &(start, end) in &parsed.scripts {
            let Some(contents) = text.get(start..end) else {
                continue;
            };
            let code = strings::trim_js_whitespace_end(contents);
            if !code.is_empty() {
                code_end = code_end.max(start + code.len());
            }
            let is_top_level =
                (scripts.iter()).any(|&(from, to)| from as usize <= start && end <= to as usize);
            if let Some(to) = program.get_mut(start..end).filter(|_| is_top_level) {
                to.copy_from_slice(contents);
            }
        }
        // The markup's code would follow here, and only the parts that declare top-level snippets matter.
        let mut end_of_scripts = program.len();
        if has_markup_code && let Some(separator) = program.get_mut(code_end..code_end + 2) {
            separator.copy_from_slice(b"\n;");
            end_of_scripts = code_end + 2;
            for &id in tree.fragment(tree.fragment) {
                if let Kind::SnippetBlock { expression, .. } = &tree[id].kind {
                    program.extend_from_slice(b"\nfunction ");
                    program.extend_from_slice(expression.of(&parsed.text));
                    program.extend_from_slice(b"(){}");
                }
            }
        } else if renders {
            program.extend_from_slice(b"export function ");
            program.extend_from_slice(&dialect.helper);
            program.extend_from_slice(b"(){}");
        }
        let kind = match dialect.is_typescript {
            true => ScriptKind::Ts,
            false => ScriptKind::Js,
        };
        let (code_end, end_of_scripts) = (code_end as u32, end_of_scripts as u32);
        let mut refusal = None;
        self.parse(path, &program, config, &How::parsed_as(kind), &mut |file| {
            let Some(file) = file else {
                return;
            };
            if let Some(mut message) = parse_error(file) {
                // The program has every offset of the component.
                let place = |(line, column): (u32, u32)| {
                    let column = column.saturating_sub(1);
                    places.position(file.offset(Position { line, column }))
                };
                let at = file.offset(Position {
                    line: message.line,
                    column: message.column.saturating_sub(1),
                });
                if message.line > 0 && (at < end_of_scripts || !has_markup_code) {
                    (message.line, message.column) = place((message.line, message.column));
                    message.end = message.end.map(place);
                    // The `;` of `\n;`, as svelte-eslint-parser has it.
                    if has_markup_code && at > code_end {
                        (message.line, message.column) = (places.position(code_end).0 + 1, 1);
                    }
                    refusal = Some(message);
                }
                return;
            }
            let mut statements = (file.body().iter())
                .map(|it| Span::new(it.span().start, it.span().end.min(code_end)))
                .filter(|it| it.start < code_end)
                .peekable();
            for (index, &(start, end)) in scripts.iter().enumerate() {
                let is_last = index + 1 == scripts.len();
                let is_taken = |it: &Span| start <= it.start && (it.end <= end || is_last);
                while statements.next_if(is_taken).is_some() {}
            }
            let unterminated = statements.next().filter(|_| is_read);
            refusal = unterminated.map(|it| {
                let (line, column) = places.position(it.end);
                LintMessage {
                    message: b"Parsing error: The script is unterminated".to_vec(),
                    line,
                    // svelte-eslint-parser counts it from 0.
                    column: column.saturating_sub(1),
                    is_fatal: true,
                    severity: Severity::Error,
                    ..LintMessage::default()
                }
            });
        });
        refusal
    }
}

/// True if the last statement of the scripts in `file`, the program `lowered`, is a `$:` statement. The `;` that ends a
/// script here, which is all an empty script consists of, doesn't count.
fn ends_in_reactive_statement<'f>(file: &'f File<'f>, lowered: &Virtual) -> bool {
    let is_in_a_script =
        |at: u32| (lowered.scripts.iter()).any(|it| it.0.start <= at && at < it.0.end);
    let last = (file.body().with_hidden())
        .filter(|it| is_in_a_script(it.span().start) && !lowered.is_synthetic(it.span()))
        .last();
    last.is_some_and(
        |it| matches!(it.kind(), StmtKind::Labeled { label, .. } if label.bytes() == b"$"),
    )
}

/// Replaces each byte of `text` with a space, except line breaks.
fn blanked(text: &[u8]) -> Vec<u8> {
    let blank = |&it: &u8| match it {
        b'\n' | b'\r' => it,
        _ => b' ',
    };
    text.iter().map(blank).collect()
}

/// True if a statement or comment in `file`, the program `lowered`, starts in a script and ends after it: a template or
/// comment that the script doesn't close. For svelte-eslint-parser no markup follows that could close it.
fn crosses_a_script<'f>(file: &'f File<'f>, lowered: &Virtual) -> bool {
    let statements = file.body().with_hidden().map(|it| it.span());
    let mut all = statements.chain(file.comments().map(|it| it.span()));
    all.any(|it| {
        let is_in = |script: &(Span, bool)| script.0.start <= it.start && it.start < script.0.end;
        (lowered.scripts.iter()).any(|script| is_in(script) && it.end > script.0.end)
    })
}

/// The component's top-level scripts, in source order.
fn top_level_scripts(tree: &Tree<'_>) -> Vec<Id> {
    let mut all: Vec<Id> = [tree.module, tree.instance].into_iter().flatten().collect();
    sort::sort_by_key(&mut all, |&it| tree[it].start);
    all
}

/// The fatal message for a component that's nested too deeply.
fn nested_too_deeply() -> LintResult {
    LintResult {
        messages: vec![too_deep()],
        ..LintResult::default()
    }
}

/// The text Svelte 5.57 reports when it rejects what `message` describes at `at` in `text`, with the link it adds, and
/// the position it reports. `None` if that isn't known: Svelte reports it in more than one way, or keeps reading. Of
/// acorn's errors, only the most common one is reproduced in Svelte's words.
fn svelte_text(message: Message, at: u32, text: &[u8]) -> Option<(Vec<u8>, u32)> {
    let svelte = |code: &[u8], said: &[&[u8]]| {
        [&said.concat()[..], b"\nhttps://svelte.dev/e/", code].concat()
    };
    let expected = |token: &[u8]| svelte(b"expected_token", &[b"Expected token ", token]);
    let rest = text.get(at as usize..).unwrap_or_default();
    // The text after `skip` bytes of `rest`, up to a byte in `ends`.
    let word_behind = |skip: usize, ends: &[u8]| {
        let word = rest.get(skip..).unwrap_or_default();
        let len = strings::index_of_any(word, ends).unwrap_or(word.len());
        word.get(..len).unwrap_or_default()
    };
    // A tag's name after its `<` or `</`, or an attribute's name.
    let name_behind = |skip: usize| word_behind(skip, b" \t\r\n/>=\"'");
    // `read_lowercase_name`
    let lowercase_behind = |skip: usize| {
        let word = rest.get(skip..).unwrap_or_default();
        word.get(..run(word, |it| it.is_ascii_lowercase()))
            .unwrap_or_default()
    };
    let said = match message {
        Message::ExpectedClosingBrace => expected(b"}"),
        Message::ExpectedClosingBracket => expected(b"]"),
        Message::ExpectedEndOfTag => expected(b">"),
        Message::ExpectedOpeningParenthesis => expected(b"("),
        Message::ExpectedClosingParenthesis => expected(b")"),
        Message::ExpectedEquals => expected(b"="),
        Message::ExpectedWhiteSpace => svelte(b"expected_whitespace", &[b"Expected whitespace"]),
        Message::EndTagWithoutStartTag => svelte(
            b"element_invalid_closing_tag",
            &[b"`</", name_behind(2), b">` attempted to close an element that was not open"],
        ),
        Message::EndTagOfVoidElement => svelte(
            b"void_element_invalid_content",
            &[b"Void elements cannot have children or closing tags"],
        ),
        // At the start of the element.
        Message::UnclosedElement => svelte(
            b"element_unclosed",
            &[b"`<", name_behind(1), b">` was left open"],
        ),
        Message::UnclosedBlock => svelte(b"block_unclosed", &[b"Block was left open"]),
        Message::UnexpectedEnd => svelte(b"unexpected_eof", &[b"Unexpected end of input"]),
        Message::UnexpectedEndOfBlock => svelte(
            b"block_unexpected_close",
            &[b"Unexpected block closing tag"],
        ),
        // Svelte has read everything that's left, and looks for the end after it.
        Message::UnclosedComment => {
            let end = strings::trim_js_whitespace_end(text).len() as u32;
            return Some((expected(b"-->"), end));
        }
        // An attribute's `{}`, or a block missing a name.
        Message::ExpectedName if rest.first() == Some(&b'{') => svelte(
            b"attribute_empty_shorthand",
            &[b"Attribute shorthand cannot be empty"],
        ),
        Message::ExpectedName => svelte(b"expected_identifier", &[b"Expected an identifier"]),
        Message::ReservedWord => {
            let word = rest.get(..run(rest, is_word_byte)).unwrap_or_default();
            svelte(
                b"unexpected_reserved_word",
                &[b"'", word, b"' is a reserved word in JavaScript and cannot be used here"],
            )
        }
        Message::ExpectedPattern => svelte(
            b"expected_pattern",
            &[b"Expected identifier or destructure pattern"],
        ),
        // After the quote of a string in a pattern. Svelte reads an unclosed quote in a script's or style's start tag
        // as part of the value.
        Message::UnclosedString if !matches!(rest.first(), Some(b'"' | b'\'')) => svelte(
            b"unterminated_string_constant",
            &[b"Unterminated string constant"],
        ),
        Message::UnknownSvelteElement => svelte(
            b"svelte_meta_invalid_tag",
            &[b"Valid `<svelte:...>` tag names are svelte:head, svelte:options, svelte:window, svelte:document, \
                svelte:body, svelte:element, svelte:component, svelte:self, svelte:fragment or svelte:boundary"],
        ),
        Message::InvalidTagName => svelte(
            b"tag_invalid_name",
            &[b"Expected a valid element or component name. Components must have a valid variable name or dot notation \
                expression"],
        ),
        Message::RepeatedElement => match name_behind(1) {
            b"script" => svelte(
                b"script_duplicate",
                &[b"A component can have a single top-level `<script>` element and/or a single top-level \
                    `<script module>` element"],
            ),
            b"style" => svelte(
                b"style_duplicate",
                &[b"A component can have a single top-level `<style>` element"],
            ),
            name => svelte(
                b"svelte_meta_duplicate",
                &[b"A component can only have one `<", name, b">` element"],
            ),
        },
        Message::NotAtTopLevel => svelte(
            b"svelte_meta_invalid_placement",
            &[b"`<", name_behind(1), b">` tags cannot be inside elements or blocks"],
        ),
        Message::RepeatedAttribute => svelte(b"attribute_duplicate", &[b"Attributes need to be unique"]),
        // At the start of the element, or at its `this` without a value.
        Message::MissingThis if rest.first() == Some(&b'<') && name_behind(1) == b"svelte:component" => {
            svelte(
                b"svelte_component_missing_this",
                &[b"`<svelte:component>` must have a 'this' attribute"],
            )
        }
        Message::MissingThis => svelte(
            b"svelte_element_missing_this",
            &[b"`<svelte:element>` must have a 'this' attribute with a value"],
        ),
        Message::InvalidThis => svelte(
            b"svelte_component_invalid_this",
            &[b"Invalid component definition \xE2\x80\x94 must be an `{expression}`"],
        ),
        Message::ExpectedValue => svelte(b"expected_attribute_value", &[b"Expected attribute value"]),
        Message::DirectiveWithoutName => svelte(
            b"directive_missing_name",
            &[b"`", name_behind(0), b"` name cannot be empty"],
        ),
        Message::InvalidDirectiveValue => svelte(
            b"directive_invalid_value",
            &[b"Directive value must be a JavaScript expression enclosed in curly braces"],
        ),
        Message::MisplacedBlock => svelte(
            b"block_invalid_placement",
            &[b"{#", lowercase_behind(2), b" ...} block cannot be in attribute value"],
        ),
        Message::MisplacedBlockInTextarea => svelte(
            b"block_invalid_placement",
            &[b"{#", lowercase_behind(2), b" ...} block cannot be inside <textarea>"],
        ),
        Message::MisplacedTag => svelte(
            b"tag_invalid_placement",
            &[b"{@", lowercase_behind(2), b" ...} tag cannot be in attribute value"],
        ),
        Message::MisplacedTagInTextarea => svelte(
            b"tag_invalid_placement",
            &[b"{@", lowercase_behind(2), b" ...} tag cannot be inside <textarea>"],
        ),
        Message::LetAsName => svelte(b"js_parse_error", &[b"The keyword 'let' is reserved"]),
        Message::UnclosedScript => svelte(b"element_unclosed", &[b"`<script>` was left open"]),
        Message::UnclosedStyle => expected(b"</style"),
        Message::ExpectedScriptEndTag => expected(b"</script>"),
        Message::ExpectedStyleEndTag => expected(b"</style>"),
        Message::ReservedScriptAttribute => svelte(
            b"script_reserved_attribute",
            &[b"The `", name_behind(0), b"` attribute is reserved and cannot be used"],
        ),
        Message::ValueOfModuleAttribute => svelte(
            b"script_invalid_attribute_value",
            &[b"If the `module` attribute is supplied, it must be a boolean attribute"],
        ),
        Message::InvalidScriptContext => svelte(
            b"script_invalid_context",
            &[b"If the context attribute is supplied, its value must be \"module\""],
        ),
        Message::InvalidDeclarationTag => svelte(
            b"declaration_tag_invalid_type",
            &[b"Declaration tags must be `let` or `const` declarations"],
        ),
        Message::UnknownBlock => svelte(
            b"expected_block_type",
            &[b"Expected 'if', 'each', 'await', 'key' or 'snippet'"],
        ),
        Message::ElseIfInOneWord => svelte(b"block_invalid_elseif", &[b"'elseif' should be 'else if'"]),
        // At the `:`.
        Message::RepeatedClause => svelte(
            b"block_duplicate_clause",
            &[b"{:", lowercase_behind(1), b"} cannot appear more than once within a block"],
        ),
        Message::InvalidDebugTag => svelte(
            b"debug_tag_invalid_arguments",
            &[b"{@debug ...} arguments must be identifiers, not arbitrary expressions"],
        ),
        Message::SequenceInConstTag => svelte(
            b"const_tag_invalid_expression",
            &[b"{@const ...} must consist of a single variable declaration"],
        ),
        Message::InvalidRenderTag => svelte(
            b"render_tag_invalid_expression",
            &[b"`{@render ...}` tags can only contain call expressions"],
        ),
        Message::UnknownTag => svelte(
            b"expected_tag",
            &[b"Expected 'html', 'render', 'attach', 'const', or 'debug'"],
        ),
        Message::NotStaticOption => svelte(
            b"svelte_options_invalid_attribute",
            &[b"`<svelte:options>` can only receive static attributes"],
        ),
        Message::InvalidOptionValue => {
            let values: &[u8] = match name_behind(0) {
                b"namespace" => b"\"html\", \"mathml\" or \"svg\"",
                b"css" => b"\"injected\"",
                _ => b"true or false",
            };
            svelte(
                b"svelte_options_invalid_attribute_value",
                &[b"Value must be ", values, b", if specified"],
            )
        }
        Message::DeprecatedTagOption => svelte(
            b"svelte_options_deprecated_tag",
            &[b"\"tag\" option is deprecated \xE2\x80\x94 use \"customElement\" instead"],
        ),
        Message::InvalidCustomElementOption => svelte(
            b"svelte_options_invalid_customelement",
            &[b"\"customElement\" must be a string literal defining a valid custom element name or an object of the form \
                { tag?: string; shadow?: \"open\" | \"none\" | `ShadowRootInit`; props?: { [key: string]: { attribute?: \
                string; reflect?: boolean; type: .. } } }"],
        ),
        Message::InvalidCustomElementName => svelte(
            b"svelte_options_invalid_tagname",
            &[b"Tag name must be lowercase and hyphenated"],
        ),
        Message::ReservedCustomElementName => {
            svelte(b"svelte_options_reserved_tagname", &[b"Tag name is reserved"])
        }
        Message::UnknownOption => svelte(
            b"svelte_options_unknown_attribute",
            &[b"`<svelte:options>` unknown attribute '", name_behind(0), b"'"],
        ),
        // At the first child.
        Message::ChildrenNotAllowed => svelte(
            b"svelte_meta_invalid_content",
            &[b"<svelte:options> cannot have children"],
        ),
        Message::ShorthandOutsidePattern => svelte(
            b"js_parse_error",
            &[b"Shorthand property assignments are valid only in destructuring patterns"],
        ),
        Message::UnexpectedToken => svelte(b"js_parse_error", &[b"Unexpected token"]),
        // Svelte names the clause the block takes, which isn't known here, or the reason why an already closed element
        // has an end tag.
        _ => return None,
    };
    Some((said, at))
}

/// svelte-eslint-parser's fatal message with `text` at `at` in the component.
fn refused_at(places: &Places, text: &[u8], at: u32) -> LintResult {
    let (line, column) = places.position(at);
    let message = LintMessage {
        message: [b"Parsing error: ", text].concat(),
        line,
        // svelte-eslint-parser passes ESLint Svelte's column, which counts from 0.
        column: column.saturating_sub(1),
        is_fatal: true,
        severity: Severity::Error,
        ..LintMessage::default()
    };
    LintResult {
        messages: vec![message],
        ..LintResult::default()
    }
}

/// How svelte-eslint-parser reads a component under the config: `parserOptions.parser` and the runes mode.
struct Dialect {
    is_typescript: bool,
    /// True unless runes are known to be off: `runes !== false`.
    runes: bool,
    /// The runes mode set by the options, the Svelte config or `<svelte:options>`.
    configured_runes: Option<bool>,
    /// The helper's name, which appears nowhere in the component.
    helper: Vec<u8>,
    /// The instance script's `generics`, which are type parameters if its `lang` is TypeScript and the parser is
    /// TypeScript's, which accepts them.
    generics: Option<GenericsSyntax>,
    /// True if typescript-eslint may accept `generics` that the native parser rejects
    /// ([`GenericsSyntax::may_be_taken`]), so ESLint lints the component.
    is_handed_off: bool,
}

impl Dialect {
    /// `lang` is [`Parsed::lang`], `language` is the component's, and `names` is [`ResolvedConfig::parser_names`].
    fn of(
        (tree, lang): (&Tree<'_>, Option<&[u8]>),
        (text, svelte_config): (&[u8], &Json),
        language: &LanguageOptions,
        names: &[(Box<[u8]>, Box<[u8]>)],
    ) -> Dialect {
        let options = &language.parser_options;
        let parser = parser_for(options.get(b"parser"), names, lang);
        let is_typescript = parser.is_some_and(is_typescript_parser);
        let mut is_handed_off = false;
        let generics = tree.instance.and_then(|script| {
            let says_typescript = matches!(lang, Some(b"ts" | b"typescript"));
            let Kind::Script { attributes, .. } = &tree[script].kind else {
                return None;
            };
            let generics = attributes.iter().find_map(|&it| match &tree[it].kind {
                Kind::Attribute {
                    name: b"generics",
                    value: Value::Parts(parts),
                } if parts.len() == 1 => match &tree[parts[0]].kind {
                    Kind::Text { .. } => Some(ast::Span {
                        start: tree[parts[0]].start,
                        end: tree[parts[0]].end,
                    }),
                    _ => None,
                },
                _ => None,
            });
            // Parsers other than TypeScript's throw on them, so they're dropped.
            let generics = generics.filter(|_| says_typescript && is_typescript)?;
            let typescript = LanguageOptions {
                parser: Parser::TypeScript,
                ..language.clone()
            };
            let syntax = GenericsSyntax::of(text, generics, &typescript);
            is_handed_off =
                syntax.is_none() && GenericsSyntax::may_be_taken(text, generics, &typescript);
            syntax
        });
        let configured_runes = runes(tree, text, options, svelte_config);
        Dialect {
            is_typescript,
            runes: configured_runes != Some(false),
            configured_runes,
            helper: fresh_name(text),
            generics,
            is_handed_off,
        }
    }
}

/// The value of `generics` as typescript-eslint's parser reads it for svelte-eslint-parser
/// (`convertGenericsAttribute`): the type parameters of a `void function<..>(){}` wrapped around it, parsed as a
/// separate file, with component positions.
struct GenericsSyntax {
    value: ast::Span,
    parameters: Vec<TypeParameter>,
    /// The comments in the value.
    comments: Vec<ast::Span>,
}

struct TypeParameter {
    span: ast::Span,
    /// From the start to the end of the name, including what's in between: the range svelte-eslint-parser declares a
    /// type alias for (`getTypeParameterRanges`).
    declared: ast::Span,
    constraint: Option<ast::Span>,
    default: Option<ast::Span>,
}

impl GenericsSyntax {
    /// The text written before and after the value.
    const AROUND: (&[u8], &[u8]) = (b"void function<", b">(){}");

    /// `None` if the parser throws on it, as on `out T`, and svelte-eslint-parser keeps it as an attribute.
    /// `typescript` holds the component's options with typescript-eslint's parser, which the linter uses to parse
    /// TypeScript.
    fn of(text: &[u8], value: ast::Span, typescript: &LanguageOptions) -> Option<GenericsSyntax> {
        let (before, after) = GenericsSyntax::AROUND;
        let program = [before, value.of(text), after].concat();
        let at = |span: Span| ast::Span {
            start: value.start + span.start - before.len() as u32,
            end: value.start + span.end - before.len() as u32,
        };
        let mut found = None;
        crate::fmt::parse_as_linted(b"generics.ts", &program, typescript, &mut |file| {
            if parse_error(file).is_some() {
                return;
            }
            let Some(StmtKind::Expr(e)) = file.body().iter().next().map(|it| it.kind()) else {
                return;
            };
            let ExprKind::Unary { operand, .. } = e.kind() else {
                return;
            };
            let Some(function) = operand.as_fn() else {
                return;
            };
            let parameters = function.type_params().iter().map(|it| TypeParameter {
                span: at(it.span()),
                declared: at(Span::new(it.span().start, it.name().span().end)),
                constraint: it.constraint().map(|it| at(it.outer_span())),
                default: it.default().map(|it| at(it.outer_span())),
            });
            found = Some(GenericsSyntax {
                value,
                parameters: parameters.collect(),
                comments: file.comments_by_id().map(|it| at(it.span())).collect(),
            });
        });
        found
    }

    /// True if typescript-eslint may accept a value that [`GenericsSyntax::of`] rejects in a module: the native parser
    /// reads its top level in the await context, where TypeScript 5 only reparses a statement for an `await` outside of
    /// types. In a script the native parser accepts it.
    fn may_be_taken(text: &[u8], value: ast::Span, typescript: &LanguageOptions) -> bool {
        let script = LanguageOptions {
            source_type: SourceType::Script,
            parser_source_type: Some(SourceType::Script),
            ..typescript.clone()
        };
        typescript.scope_source_type() == SourceType::Module
            && GenericsSyntax::of(text, value, &script).is_some()
    }
}

/// The instance script's `generics` that `dialect` reads as type parameters, and each one's position.
fn generics_of(tree: &Tree<'_>, dialect: &Dialect) -> Option<crate::svelte_summary::Generics> {
    let generics = dialect.generics.as_ref()?;
    let Kind::Script { attributes, .. } = &tree[tree.instance?].kind else {
        return None;
    };
    let attribute = *attributes.iter().find(|&&it| {
        matches!(&tree[it].kind, Kind::Attribute { name: b"generics", value: Value::Parts(parts) }
            if parts.first().is_some_and(|&part| tree[part].start == generics.value.start))
    })?;
    let parameters = generics.parameters.iter();
    Some(crate::svelte_summary::Generics {
        attribute,
        parameters: parameters
            .map(|it| Span::new(it.span.start, it.span.end))
            .collect(),
    })
}

/// The text of an attribute whose value is a single text, like `lang="ts"`. `None` for any other value, which
/// svelte-eslint-parser sees as `undefined`.
fn text_of<'a>(tree: &Tree<'a>, value: &Value) -> Option<&'a [u8]> {
    match value.parts() {
        [only] => match &tree[*only].kind {
            Kind::Text { raw } => match raw {
                std::borrow::Cow::Borrowed(raw) => Some(raw),
                std::borrow::Cow::Owned(_) => None,
            },
            _ => None,
        },
        _ => None,
    }
}

/// `getParserForLang`: the name of the scripts' parser. `None` means espree. `names` covers the parsers that `parser`
/// maps to, where the options can't name them.
fn parser_for<'j>(
    parser: Option<&'j Json>,
    names: &'j [(Box<[u8]>, Box<[u8]>)],
    lang: Option<&[u8]>,
) -> Option<&'j [u8]> {
    let name = |value: &'j Json| match value {
        Json::String(name) => Some(&name[..]),
        // A parser object among others, as the config describes it.
        object @ Json::Object(_) if is_parser_object(object) => {
            object.get(b"meta")?.get(b"name")?.as_str()
        }
        _ => None,
    };
    match parser? {
        it @ Json::String(_) => name(it),
        it if is_parser_object(it) => name(it),
        map @ Json::Object(_) => {
            let lang = lang.filter(|it| !it.is_empty()).unwrap_or(b"js");
            let named = || {
                names
                    .iter()
                    .find(|it| it.0[..] == *lang)
                    .map(|it| &it.1[..])
            };
            name(map.get(lang)?).or_else(named)
        }
        _ => None,
    }
}

fn is_parser_object(value: &Json) -> bool {
    value.get(b"parseForESLint").is_some() || value.get(b"parse").is_some()
}

/// svelte-eslint-parser's `isTypeScript`, for a named parser. A path containing one of the names is assumed to be that
/// package, where svelte-eslint-parser reads its `package.json`.
fn is_typescript_parser(name: &[u8]) -> bool {
    let name = without_version(name);
    let names: [&[u8]; 3] = [
        b"@typescript-eslint/parser",
        b"typescript-eslint-parser-for-extra-files",
        // `meta.name` of typescript-eslint's parser object.
        b"typescript-eslint/parser",
    ];
    names.iter().any(|it| strings::contains(name, it))
}

/// `isRunesAsParseContext`: `parserOptions.svelteFeatures.runes`, then `runes` in the Svelte config's `compilerOptions`
/// ([`Contexts::svelte_config`](crate::svelte_context::Contexts::svelte_config)), then `<svelte:options runes>`.
fn runes(tree: &Tree<'_>, text: &[u8], options: &Json, svelte_config: &Json) -> Option<bool> {
    fn option(json: Option<&Json>) -> Option<&Json> {
        json.filter(|it| **it != Json::Null)
    }
    let features = option(
        options
            .get(b"svelteFeatures")
            .and_then(|it| it.get(b"runes")),
    );
    if let Some(runes) = features {
        return runes.as_bool();
    }
    let config = (svelte_config.get(b"compilerOptions")).and_then(|it| it.get(b"runes"));
    if let Some(runes) = option(config) {
        return runes.as_bool();
    }
    let Kind::Element(element) = &tree[tree.options?].kind else {
        return None;
    };
    element
        .attributes
        .iter()
        .find_map(|&it| match &tree[it].kind {
            Kind::Attribute {
                name: b"runes",
                value,
            } => match value {
                Value::True => Some(true),
                Value::Tag(tag) => match &tree[*tag].kind {
                    Kind::ExpressionTag(e) => {
                        match &text[e.span.start as usize..e.span.end as usize] {
                            b"false" => Some(false),
                            b"true" => Some(true),
                            _ => None,
                        }
                    }
                    _ => None,
                },
                Value::Parts(_) => None,
            },
            _ => None,
        })
}

/// `$$h`, `$$h1`, `$$h2` ..: the first one that's not an identifier in `text`, even one written with escapes.
fn fresh_name(text: &[u8]) -> Vec<u8> {
    let escaped = escaped_identifiers(text);
    let mut name = b"$$h".to_vec();
    for suffix in 1u32.. {
        let is_free = |name: &[u8]| {
            !strings::contains(text, name) && !escaped.iter().any(|it| strings::contains(it, name))
        };
        if is_free(&name) {
            break;
        }
        name = format!("$$h{suffix}").into_bytes();
    }
    name
}

/// The identifiers that contain `\u` escapes, decoded.
fn escaped_identifiers(text: &[u8]) -> Vec<Vec<u8>> {
    let is_part = |byte: u8| {
        byte.is_ascii_alphanumeric()
            || matches!(byte, b'_' | b'$' | b'\\' | b'{' | b'}')
            || byte >= 0x80
    };
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(at) = strings::index_of(&text[from..], b"\\u") {
        let at = from + at;
        let start = text[..at]
            .iter()
            .rposition(|&it| !is_part(it))
            .map_or(0, |it| it + 1);
        let end = (text[at..].iter().position(|&it| !is_part(it))).map_or(text.len(), |it| at + it);
        found.push(decoded(&text[start..end]));
        from = end.max(at + 2);
    }
    found
}

/// Decodes `\uXXXX` and `\u{X}` to their characters.
fn decoded(identifier: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(identifier.len());
    let mut at = 0;
    while at < identifier.len() {
        let rest = &identifier[at..];
        let Some(escape) = rest.strip_prefix(b"\\u") else {
            out.push(rest[0]);
            at += 1;
            continue;
        };
        let (digits, len) = match escape.strip_prefix(b"{") {
            Some(braced) => {
                let close =
                    strings::index_of_char(braced, b'}').map_or(braced.len(), |it| it as usize);
                (&braced[..close], 2 + 1 + close + 1)
            }
            None => (&escape[..escape.len().min(4)], 2 + escape.len().min(4)),
        };
        let code = std::str::from_utf8(digits)
            .ok()
            .and_then(|it| u32::from_str_radix(it, 16).ok());
        match code.and_then(char::from_u32) {
            Some(c) => out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes()),
            None => out.extend_from_slice(&rest[..len.min(rest.len())]),
        }
        at += len;
    }
    out
}

/// The program a component is lowered to.
#[derive(Default)]
pub(crate) struct Virtual {
    pub(crate) text: Vec<u8>,
    /// In program order, one after another.
    segments: Vec<Segment>,
    /// The component's length.
    original_len: u32,
    /// The scripts' spans in the program, and whether each is `context="module"`.
    scripts: Vec<(Span, bool)>,
    /// The component ranges written in markup block comments, in order.
    markups: Vec<(u32, u32)>,
    /// The `let:` value patterns. They're in markup, and their copies are code.
    lets: Vec<(u32, u32)>,
    /// The starts of glue where a node visible to rules starts. See [`View::show_at`].
    shown: Vec<u32>,
    /// Line comments that end scripts, which glue wraps in a block comment.
    line_comments: Vec<Span>,
    /// The start of the restorations at the end.
    trailer: u32,
    /// The starts of the names of snippets passed to components.
    given: Vec<u32>,
    /// The component starts of the names that `bind:` binds. See [`Adjustment::ReadWrite`].
    binds: Vec<u32>,
    /// The code of directive names, in the component, and what svelte-eslint-parser requires it to be.
    expected: Vec<(ast::Span, Expected)>,
    /// The starts of the nodes whose scopes stand for component nodes, and those component nodes. See [`Lowered`].
    pub(crate) scope_owners: Vec<(u32, Id, Of)>,
}

/// What svelte-eslint-parser requires the code of a directive's name to be when it parses it again. It throws on the
/// first one that isn't.
#[derive(Clone, Copy)]
enum Expected {
    /// `buildExpressionTypeChecker`: one of these types, for the names of `use:`, `animate:` and transitions.
    Js(&'static [&'static str]),
    /// `processDirectiveExpression`: the `Identifier` Svelte has for the name in `bind:x` and `class:x`.
    Identifier,
    /// `convertStyleDirective`: an `Identifier`, for the name in `style:x`.
    StyleKey,
}

impl Expected {
    /// svelte-eslint-parser's error for code of type `found`, if it rejects that.
    fn refusal(self, found: &str) -> Option<Vec<u8>> {
        let text = match self {
            Expected::Js(types) if !types.contains(&found) => {
                format!("Expected JS {}, but {found} found.", types.join(", or "))
            }
            Expected::Identifier if found != "Identifier" => {
                format!("Expected Identifier, but {found} found.")
            }
            Expected::StyleKey if found != "Identifier" => {
                "Expected JS identifier or attribute value.".to_owned()
            }
            _ => return None,
        };
        Some(text.into_bytes())
    }
}

impl Virtual {
    fn push(&mut self, piece: Piece, bytes: &[u8], from: u32) {
        if bytes.is_empty() {
            return;
        }
        let at = self.text.len() as u32;
        self.text.extend_from_slice(bytes);
        let len = bytes.len() as u32;
        if let Some(last) = self.segments.last_mut()
            && last.piece == piece
            && match piece {
                Piece::Glue => last.from == from,
                Piece::Original | Piece::Copy | Piece::StandIn => last.from + last.len == from,
            }
        {
            last.len += len;
            return;
        }
        self.segments.push(Segment {
            at,
            len,
            piece,
            from,
        });
    }

    /// True if the markup has code, which svelte-eslint-parser writes after the scripts (`ScriptsSourceCode.addLet`):
    /// parts of the component that the program has as code, other than the scripts, the markup, a byte order mark and
    /// the restorations at the end. A copy counts as code wherever it's copied from: `let:` declarations and the
    /// parameters of `generics`.
    fn has_markup_code(&self) -> bool {
        let is_in_script =
            |at: u32| (self.scripts.iter()).any(|it| it.0.start <= at && at < it.0.end);
        let is_markup =
            |from: u32| (self.markups.iter()).any(|&(start, end)| start <= from && from < end);
        let mut code = (self.segments.iter()).filter(|it| {
            let bytes = self.text.get(it.at as usize..it.end() as usize);
            let bytes = bytes.unwrap_or_default().trim_ascii();
            !bytes.is_empty() && bytes != b"\xEF\xBB\xBF" && it.at < self.trailer
        });
        code.any(|it| match it.piece {
            Piece::Copy => true,
            Piece::Original => !is_in_script(it.at) && !is_markup(it.from),
            Piece::Glue | Piece::StandIn => false,
        })
    }

    /// [`Virtual::markups`] without the `let:` patterns, whose tokens are code tokens.
    fn markups_without_lets(&self) -> Vec<(u32, u32)> {
        let mut out = Vec::with_capacity(self.markups.len());
        let mut lets = self.lets.clone();
        sort::sort_unstable(&mut lets);
        let mut lets = lets.into_iter().peekable();
        for &(start, end) in &self.markups {
            let mut at = start;
            while let Some(&(from, to)) = lets.peek()
                && from < end
            {
                if from > at {
                    out.push((at, from));
                }
                at = at.max(to);
                // It continues in the next range.
                if to > end {
                    break;
                }
                lets.next();
            }
            if at < end {
                out.push((at, end));
            }
        }
        out
    }

    fn segment_at(&self, offset: u32) -> Option<&Segment> {
        let index = self.segments.partition_point(|it| it.end() <= offset);
        self.segments.get(index)
    }

    fn is_glue(&self, offset: u32) -> bool {
        self.segment_at(offset)
            .is_some_and(|it| it.piece == Piece::Glue)
    }

    /// True if a report at `span` is about glue: it starts in glue that doesn't follow source text, or it's all glue. A
    /// call to the helper or a callback starts where glue starts, after other glue.
    pub(crate) fn is_synthetic(&self, span: Span) -> bool {
        if !self.is_glue(span.start) {
            return false;
        }
        if span.start == 0 || self.is_glue(span.start - 1) || span.is_empty() {
            return true;
        }
        let mut at = span.start;
        while at < span.end {
            match self.segment_at(at) {
                Some(segment) if segment.piece == Piece::Glue => at = segment.end(),
                _ => return false,
            }
        }
        true
    }

    /// The component position of a start at `offset` in the program.
    fn start_of(&self, offset: u32) -> u32 {
        self.segment_at(offset)
            .map_or(self.original_len, |it| it.place_of(offset))
    }

    /// The component position of an end at `offset` in the program: right after the byte before it.
    fn end_of(&self, offset: u32) -> u32 {
        match offset.checked_sub(1).and_then(|it| self.segment_at(it)) {
            Some(segment) if segment.piece == Piece::Glue => segment.from,
            Some(segment) => segment.place_of(offset - 1) + 1,
            None => 0,
        }
    }

    /// The component range that a fix at `span` in the program changes. `None` if it changes glue. In a copy, it
    /// changes the copied text, because svelte-eslint-parser has the copied code at its source position.
    fn original_span(&self, span: Span) -> Option<Span> {
        let copy = self
            .segment_at(span.start)
            .filter(|it| it.piece == Piece::Copy);
        if let Some(copy) = copy.filter(|it| span.end <= it.end()) {
            let start = copy.place_of(span.start);
            return Some(Span::new(start, start + span.len()));
        }
        if span.is_empty() {
            let after = self
                .segment_at(span.start)
                .filter(|it| it.piece == Piece::Original);
            let before = (span.start.checked_sub(1))
                .and_then(|it| self.segment_at(it))
                .filter(|it| it.piece == Piece::Original);
            return match (before, after) {
                (Some(_), _) => Some(Span::empty(self.end_of(span.start))),
                (None, Some(_)) => Some(Span::empty(self.start_of(span.start))),
                (None, None) => (span.start == 0).then_some(Span::empty(0)),
            };
        }
        let mut at = span.start;
        while at < span.end {
            match self.segment_at(at) {
                Some(segment) if matches!(segment.piece, Piece::Original | Piece::StandIn) => {
                    at = segment.end();
                }
                _ => return None,
            }
        }
        Some(Span::new(self.start_of(span.start), self.end_of(span.end)))
    }

    /// `fix` without the glue at its ends that it rewrites unchanged, such as the `;` after a `{let x = 1}`.
    fn without_glue_around(&self, mut fix: Fix) -> Fix {
        while let Some(segment) = self
            .segment_at(fix.span.start)
            .filter(|it| it.piece == Piece::Glue)
        {
            let end = segment.end().min(fix.span.end);
            let glue = self
                .text
                .get(fix.span.start as usize..end as usize)
                .unwrap_or_default();
            if glue.is_empty() || !fix.text.starts_with(glue) {
                break;
            }
            fix.text.drain(..glue.len());
            fix.span = Span::new(end, fix.span.end);
        }
        loop {
            let last = fix
                .span
                .end
                .checked_sub(1)
                .filter(|&it| it >= fix.span.start);
            let Some(segment) = last
                .and_then(|it| self.segment_at(it))
                .filter(|it| it.piece == Piece::Glue)
            else {
                break;
            };
            let start = segment.at.max(fix.span.start);
            let glue = self
                .text
                .get(start as usize..fix.span.end as usize)
                .unwrap_or_default();
            if glue.is_empty() || !fix.text.ends_with(glue) {
                break;
            }
            fix.text.truncate(fix.text.len() - glue.len());
            fix.span = Span::new(fix.span.start, start);
        }
        fix
    }

    /// `fix`, which starts and ends in source text, translated to positions in the component `original`, where it
    /// rewrites the glue inside it unchanged: the glue of a line comment that ends a script, or the `;` that ends the
    /// scripts, which a fix of a statement copies. A [stand-in](Piece::StandIn) that it rewrites becomes the text it
    /// stands for. `None` if it changes glue.
    fn without_glue_within(&self, fix: &Fix, original: &[u8]) -> Option<Fix> {
        let span = fix.span;
        let is_written = |at: u32| {
            self.segment_at(at)
                .is_some_and(|it| matches!(it.piece, Piece::Original | Piece::StandIn))
        };
        if span.is_empty() || !is_written(span.start) || !is_written(span.end - 1) {
            return None;
        }
        let old = self.text.get(span.start as usize..span.end as usize)?;
        let new = &fix.text[..];
        let same_start = old.iter().zip(new).take_while(|(a, b)| a == b).count();
        let most = old.len().min(new.len()) - same_start;
        let same_end = (old.iter().rev())
            .zip(new.iter().rev())
            .take(most)
            .take_while(|(a, b)| a == b)
            .count();
        // The bytes of `new` that are glue or stand-ins, which it has where `old` has them, and their component text.
        let mut replaced: Vec<(std::ops::Range<usize>, &[u8])> = Vec::new();
        let mut at = span.start;
        while at < span.end {
            let segment = self.segment_at(at)?;
            let end = segment.end().min(span.end);
            let written: &[u8] = match segment.piece {
                Piece::Glue => b"",
                Piece::StandIn => {
                    let from = segment.place_of(at) as usize;
                    original.get(from..from + (end - at) as usize)?
                }
                Piece::Original | Piece::Copy => {
                    at = end;
                    continue;
                }
            };
            let (from, to) = ((at - span.start) as usize, (end - span.start) as usize);
            if to <= same_start {
                replaced.push((from..to, written));
            } else if from >= old.len() - same_end {
                let behind = |it: usize| new.len() - (old.len() - it);
                replaced.push((behind(from)..behind(to), written));
            } else if segment.piece == Piece::Glue {
                return None;
            }
            at = end;
        }
        let mut text = Vec::with_capacity(new.len());
        let mut next = 0;
        for (range, written) in replaced {
            text.extend_from_slice(new.get(next..range.start)?);
            text.extend_from_slice(written);
            next = range.end;
        }
        text.extend_from_slice(new.get(next..)?);
        let span = Span::new(self.start_of(span.start), self.end_of(span.end));
        Some(Fix { span, text })
    }

    /// True if `span` in the program contains glue.
    fn has_glue_within(&self, span: Span) -> bool {
        let first = self.segments.partition_point(|it| it.end() <= span.start);
        (self.segments.get(first..).unwrap_or_default().iter())
            .take_while(|it| it.at < span.end)
            .any(|it| it.piece == Piece::Glue)
    }

    /// Moves `message`, which a rule reported in the program `file`, to its position in the component. A message that's
    /// already in the component stays where it is.
    fn to_original(&self, message: &mut LintMessage, file: &File<'_>, places: &Places<'_>) {
        let domain = std::mem::replace(&mut message.domain, Domain::Original);
        message.anchor = None;
        if domain == Domain::Original || message.line == 0 {
            return;
        }
        let offset_of = |(line, column): (u32, u32)| {
            file.offset(Position {
                line,
                column: column.saturating_sub(1),
            })
        };
        let start = self.start_of(offset_of((message.line, message.column)));
        (message.line, message.column) = places.position(start);
        let end_of = |end: (u32, u32)| places.position(self.end_of(offset_of(end)).max(start));
        message.end = message.end.map(end_of);
        if let Some(details) = &mut message.details {
            for label in &mut details.labels {
                let at = self.start_of(offset_of(label.0));
                (label.0, label.1) = (
                    places.position(at),
                    places.position(self.end_of(offset_of(label.1)).max(at)),
                );
            }
        }
        if let Some((from, to)) = message.comments_apply_at {
            let at = self.start_of(offset_of(from));
            let to = places.position(self.end_of(offset_of(to)).max(at));
            message.comments_apply_at = Some((places.position(at), to));
        }
        message.claim = message.claim.map(|it| it.moved(|it| self.start_of(it)));
        let moved = |fix: Fix| {
            let fix = self.without_glue_around(fix);
            let span = match self.original_span(fix.span) {
                None if fix.text.is_empty() && !fix.span.is_empty() => {
                    self.removed_span(fix.span)?
                }
                None => return self.without_glue_within(&fix, places.text),
                span => span?,
            };
            Some(Fix { span, ..fix })
        };
        message.fix = message.fix.take().and_then(moved);
        let suggestions = std::mem::take(&mut message.suggestions);
        message.suggestions = (suggestions.into_iter())
            .filter_map(|it| {
                let fix = moved(it.fix.clone())?;
                Some(bun_lint::linter::Suggestion { fix, ..it })
            })
            .collect();
    }

    /// `message`, which is about the component, prepared for merging with the rules' reports about the program `file`:
    /// its start in the program is its [anchor](LintMessage::anchor).
    fn anchored(&self, message: &LintMessage, file: &File<'_>, places: &Places<'_>) -> LintMessage {
        let anchor = (message.line != 0)
            .then(|| self.place_in_program((message.line, message.column), file, places));
        LintMessage {
            domain: Domain::Original,
            anchor,
            ..message.clone()
        }
    }

    /// The position in the program `file` of the component line and column in `places`.
    fn place_in_program(
        &self,
        (line, column): (u32, u32),
        file: &File<'_>,
        places: &Places,
    ) -> (u32, u32) {
        let at = file.position(bun_lint::ast::view::in_program(
            &self.segments,
            places.offset(line, column),
        ));
        (at.line, at.column + 1)
    }

    /// The part of the program that rules see, built from the component `original` with `plan`.
    fn view(&self, original: &[u8], plan: &Plan) -> View {
        let mut view = View::new(original, self.segments.clone());
        for &at in &self.shown {
            view.show_at(at);
        }
        for &at in &plan.retyped {
            view.retype_at(at);
        }
        view.hide_from(self.trailer);
        for &span in &self.line_comments {
            view.add_line_comment(span);
        }
        for &adjustment in &plan.adjustments {
            view.adjust(adjustment);
        }
        let mut binds = self.binds.clone();
        sort::sort_unstable(&mut binds);
        self.to_program(&mut binds);
        for at in binds {
            view.adjust(Adjustment::ReadWrite { at });
        }
        let tokens = markup_tokens(original, &self.markups_without_lets());
        let mut places = (tokens.iter())
            .flat_map(|it| [it.0, it.1.saturating_sub(1)])
            .collect::<Vec<_>>();
        self.to_program(&mut places);
        for (token, place) in tokens.iter().zip(places.chunks(2)) {
            if let [start, last] = *place {
                view.add_token(Span::new(start, last + 1), token.2);
            }
        }
        view
    }

    /// Replaces each of `offsets`, which are sorted component offsets of source text, with its program offset.
    fn to_program(&self, offsets: &mut [u32]) {
        let mut original = self
            .segments
            .iter()
            .filter(|it| it.piece == Piece::Original);
        let mut segment = original.next();
        for offset in offsets.iter_mut() {
            while segment.is_some_and(|it| it.from + it.len <= *offset) {
                segment = original.next();
            }
            *offset = match segment {
                Some(it) if it.from <= *offset => it.at + (*offset - it.from),
                _ => self.text.len() as u32,
            };
        }
    }

    /// svelte-eslint-parser's error for the first directive name in the program `file` that isn't the code it requires
    /// ([`Expected`]), and its start in the component.
    fn refusal<'f>(&self, file: &'f File<'f>) -> Option<(Vec<u8>, u32)> {
        self.expected.iter().find_map(|&(span, expected)| {
            let mut start = [span.start];
            self.to_program(&mut start);
            let [start] = start;
            let found = file.node_with_span(Span::new(start, start + (span.end - span.start)))?;
            let text = expected.refusal(estree_type_name(found))?;
            Some((text, span.start))
        })
    }

    /// The component range that a fix removing `span` from the program removes: its source text, plus the glue around
    /// it. `None` if that isn't a single component range.
    fn removed_span(&self, span: Span) -> Option<Span> {
        let first = self.segments.partition_point(|it| it.end() <= span.start);
        let mut removed: Option<(Span, Piece)> = None;
        for segment in self.segments.get(first..).unwrap_or_default() {
            if segment.at >= span.end {
                break;
            }
            if segment.piece == Piece::Glue {
                continue;
            }
            let start = segment.place_of(segment.at.max(span.start));
            let end = segment.place_of(segment.end().min(span.end) - 1) + 1;
            removed = match removed {
                None => Some((Span::new(start, end), segment.piece)),
                Some((it, piece)) if it.end == start && piece == segment.piece => {
                    Some((Span::new(it.start, end), piece))
                }
                Some(_) => return None,
            };
        }
        removed.map(|it| it.0)
    }

    /// Debug-build check: every byte of `original` is in the program exactly once, in order, a copy matches what it
    /// copies except for line breaks, and no synthesized code breaks a line.
    fn holds_for(&self, original: &[u8]) -> bool {
        let mut next = 0u32;
        let mut at = 0u32;
        for segment in &self.segments {
            if segment.at != at {
                return false;
            }
            let bytes = &self.text[segment.at as usize..segment.end() as usize];
            let source = segment.from as usize..(segment.from + segment.len) as usize;
            let holds = match segment.piece {
                Piece::Original => {
                    let is_next = segment.from == next;
                    next += segment.len;
                    is_next && original.get(source) == Some(bytes)
                }
                Piece::Glue => !breaks_lines(bytes),
                Piece::StandIn => {
                    let is_next = segment.from == next;
                    next += segment.len;
                    is_next && !breaks_lines(bytes)
                }
                Piece::Copy => {
                    let copied = original.get(source).map(without_line_breaks);
                    copied.as_deref() == Some(bytes)
                }
            };
            if !holds {
                return false;
            }
            at = segment.end();
        }
        at as usize == self.text.len() && next as usize == original.len()
    }
}

const LINE_SEPARATOR: &[u8] = "\u{2028}".as_bytes();
const PARAGRAPH_SEPARATOR: &[u8] = "\u{2029}".as_bytes();

/// True if `bytes` contains an ECMAScript line terminator.
fn breaks_lines(bytes: &[u8]) -> bool {
    strings::index_of_any(bytes, b"\n\r").is_some()
        || strings::contains(bytes, LINE_SEPARATOR)
        || strings::contains(bytes, PARAGRAPH_SEPARATOR)
}

/// `bytes` with a space for each byte of a line terminator, so a copy has the same length as its source and stays on
/// one line.
fn without_line_breaks(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut rest = bytes;
    while let Some((&first, after)) = rest.split_first() {
        if rest.starts_with(LINE_SEPARATOR) || rest.starts_with(PARAGRAPH_SEPARATOR) {
            out.extend_from_slice(b"   ");
            rest = rest.get(3..).unwrap_or_default();
            continue;
        }
        out.push(if matches!(first, b'\n' | b'\r') {
            b' '
        } else {
            first
        });
        rest = after;
    }
    out
}

/// What a lowering adds besides the component, as the first program built is found to need it.
#[derive(Default, Clone)]
struct Plan {
    /// The starts of line comments that end a script. A glue block comment wraps each one, so the markup after the end
    /// tag, or the `;` after the scripts' last code, isn't part of it.
    line_comments: Vec<u32>,
    /// The restorations at the end, once the program without them has been inspected.
    trailer: Option<Vec<Part>>,
    /// The starts of statements that svelte-eslint-parser has as nodes of another kind. See [`View::retype_at`].
    retyped: Vec<u32>,
    /// The reference repairs the program turns out to need.
    adjustments: Vec<Adjustment>,
}

/// A part of the trailer.
#[derive(Clone)]
enum Part {
    Glue(Vec<u8>),
    /// The component's text at that span.
    Copy(ast::Span),
}

impl Plan {
    /// What the program `file`, which `lowered` describes, still needs. `None` if nothing, so it's linted as is.
    fn revised<'f>(
        &self,
        file: &'f File<'f>,
        lowered: &Virtual,
        dialect: &Dialect,
    ) -> Option<Plan> {
        let mut line_comments = Vec::new();
        // Glue inside it: the markup after the end tag, or the `;` after the scripts' last code.
        for comment in file.comments_by_id().filter(|it| !it.is_block()) {
            let span = comment.span();
            let in_script = (lowered.scripts.iter())
                .any(|(script, _)| script.start <= span.start && span.start < script.end);
            if in_script && lowered.has_glue_within(span) {
                line_comments.push(lowered.start_of(span.start));
            }
        }
        if !line_comments.is_empty() && self.line_comments.is_empty() {
            return Some(Plan {
                line_comments,
                ..self.clone()
            });
        }
        if self.trailer.is_some() {
            return None;
        }
        let restored = restorations(file, lowered, dialect);
        let is_needed = !restored.trailer.is_empty()
            || !restored.retyped.is_empty()
            || !restored.adjustments.is_empty();
        is_needed.then(|| Plan {
            trailer: Some(restored.trailer),
            retyped: restored.retyped,
            adjustments: restored.adjustments,
            ..self.clone()
        })
    }
}

/// What [`restorations`] finds.
struct Restored {
    trailer: Vec<Part>,
    retyped: Vec<u32>,
    adjustments: Vec<Adjustment>,
}

/// svelte-eslint-parser's scope repairs (`analyze-scope.ts`) for the program `file`:
///
/// - `analyzeStoreScope`: an undeclared `$x` reads `x` where the top level declares it, and gets declared, by code at
///   the end.
/// - `analyzeReactiveScope`: an undeclared variable that a top-level `$: x = ..` assigns gets declared, by code at the
///   end. Its variable doesn't have the assigning reference there. The `$:` isn't a label.
/// - `analyzePropsScope`: `export let x`, `export { x }` and `let { x = $bindable() } = $props()` are read and written,
///   in any script except `context="module"` ones.
///
/// `analyzeSnippetsScope` happens when a snippet is lowered, and the parameters of `generics` are lowered with the
/// component.
fn restorations<'f>(file: &'f File<'f>, lowered: &Virtual, dialect: &Dialect) -> Restored {
    let top = file.top_level_scope();
    let helper = &dialect.helper[..];
    let svelte_globals = SVELTE_GLOBALS
        .iter()
        .chain(if dialect.runes { &RUNES[..] } else { &[] });
    let is_svelte_global = |name: &[u8]| svelte_globals.clone().any(|it| it.as_bytes() == name);
    let (mut parts, mut retyped, mut adjustments) = (Vec::new(), Vec::new(), Vec::new());
    // In the order they're found, which is the order of the code that declares them.
    let mut stores: Vec<&[u8]> = Vec::new();
    let mut is_store: bun_sema::util::FxHashSet<&[u8]> = Default::default();
    // A store's `$x`.
    let store_of = |name: &[u8], declared: &dyn Fn(&[u8]) -> bool| {
        (name.len() > 1
            && name.starts_with(b"$")
            && !is_svelte_global(name)
            && declared(&name[1..]))
        .then_some(())
    };
    let declared_at_top = |name: &[u8]| top.get_bytes(name).is_some();
    for reference in file.unresolved_references() {
        let name = reference.name().bytes();
        if store_of(name, &declared_at_top).is_some() && is_store.insert(name) {
            stores.push(name);
        }
    }
    // A top-level `$:` that assigns an undeclared variable.
    let mut reactive: Vec<(&[u8], Span)> = Vec::new();
    let mut is_reactive: bun_sema::util::FxHashSet<&[u8]> = Default::default();
    let targets: Vec<Span> = (file.body().iter())
        .filter_map(|statement| match statement.kind() {
            StmtKind::Labeled { label, body } if label.bytes() == b"$" => {
                retyped.push(statement.span().start);
                match body.kind() {
                    StmtKind::Expr(e) => match e.kind() {
                        ExprKind::Assign { target, .. } => Some(target.span()),
                        _ => None,
                    },
                    _ => None,
                }
            }
            _ => None,
        })
        .collect();
    // The targets belong to consecutive statements.
    let is_in_target = |span: Span| {
        let at = targets.partition_point(|it| it.start <= span.start);
        at.checked_sub(1)
            .and_then(|at| targets.get(at))
            .is_some_and(|it| span.end <= it.end)
    };
    for reference in file.unresolved_references() {
        let (name, span) = (reference.name().bytes(), reference.span());
        let is_assigned =
            reference.is_write() && reference.scope().id() == top.id() && is_in_target(span);
        if !is_assigned || is_store.contains(name) {
            continue;
        }
        adjustments.push(Adjustment::Hide { at: span.start });
        if is_reactive.insert(name) {
            reactive.push((name, span));
        }
    }
    // Their stores: `analyzeStoreScope` runs again.
    for reference in file.unresolved_references() {
        let name = reference.name().bytes();
        if store_of(name, &|it| is_reactive.contains(it)).is_some() && is_store.insert(name) {
            stores.push(name);
        }
    }
    for (_, span) in &reactive {
        let original = lowered.start_of(span.start);
        let len = span.end - span.start;
        parts.push(Part::Glue(b"var ".to_vec()));
        parts.push(Part::Copy(ast::Span {
            start: original,
            end: original + len,
        }));
        parts.push(Part::Glue(b";".to_vec()));
    }
    for name in &stores {
        let base = &name[1..];
        let code = [b"var ", *name, b";", helper, b"(", base, b",", *name, b");"].concat();
        parts.push(Part::Glue(code));
    }
    // Props.
    let in_props_script = |span: Span| {
        (lowered.scripts.iter()).any(|(script, is_module)| {
            !*is_module && script.start <= span.start && span.end <= script.end
        })
    };
    // By name, because the code may spell it with escapes.
    let mut props: Vec<&[u8]> = Vec::new();
    let is_variable = |name: &[u8]| {
        top.get_bytes(name).is_some_and(|symbol| {
            symbol.declarations().any(|it| match it {
                Declaration::Var(_) => match it.node() {
                    Some(Node::VarDecl(d)) => {
                        matches!(d.var_kind(), VarKind::Let | VarKind::Var)
                    }
                    _ => false,
                },
                _ => false,
            })
        })
    };
    for statement in file.body().iter().filter(|it| in_props_script(it.span())) {
        match statement.kind() {
            StmtKind::Var(declarations) => {
                for d in declarations.iter() {
                    if !matches!(d.var_kind(), VarKind::Let | VarKind::Var) {
                        continue;
                    }
                    if statement.is_exported() {
                        d.pat().for_each_binding(&mut |it| {
                            props.extend(it.as_ident().map(|it| it.bytes()))
                        });
                    } else if dialect.runes
                        && d.pat().tag() == bun_lint::ast::PatTag::Object
                        && d.init()
                            .and_then(|it| it.callee())
                            .and_then(|it| it.as_ident())
                            .is_some_and(|it| it.bytes() == b"$props")
                    {
                        let mut found = Vec::new();
                        bindables(d.pat(), &mut found);
                        props.extend(found);
                    }
                }
            }
            StmtKind::ExportNamed(export) if !export.has_from() => {
                for spec in export.items().iter() {
                    let local = spec.local();
                    if is_variable(local.bytes()) {
                        props.push(local.bytes());
                    }
                }
            }
            _ => {}
        }
    }
    // The reference that svelte-eslint-parser adds isn't a value reference, so typescript-eslint would count it as a
    // use as a type. An exported prop counts as used either way.
    let mut written: bun_sema::util::FxHashSet<u32> = Default::default();
    for name in props {
        let declared = (top.get_bytes(name))
            .and_then(|symbol| symbol.declarations().next())
            .and_then(|it| it.name_span());
        let Some(at) = declared.map(|it| it.start) else {
            continue;
        };
        if written.insert(at) {
            adjustments.push(Adjustment::Add {
                at,
                read: true,
                write: true,
            });
        }
    }
    // A snippet passed to a component is read there if something else names it, and otherwise declares nothing. This
    // holds the first symbol that declares a name at each position.
    let mut declaring: Vec<(u32, Symbol<'_>)> = Vec::new();
    if !lowered.given.is_empty() {
        for symbol in file.symbols() {
            let starts = symbol
                .declarations()
                .filter_map(|it| it.name_span())
                .map(|it| it.start);
            declaring.extend(starts.map(|start| (start, symbol)));
        }
        bun_lint::utils::sort::sort_by_key(&mut declaring, |it| it.0);
    }
    for &at in &lowered.given {
        let first = declaring.partition_point(|it| it.0 < at);
        let Some(&(_, snippet)) = declaring.get(first).filter(|it| it.0 == at) else {
            continue;
        };
        adjustments.push(match snippet.references().len() {
            0 => Adjustment::Undeclare { at },
            _ => Adjustment::Add {
                at,
                read: true,
                write: false,
            },
        });
    }
    Restored {
        trailer: parts,
        retyped,
        adjustments,
    }
}

/// The names in a `$props()` object pattern whose default is `$bindable()`, at any depth.
fn bindables<'f>(pattern: Pat<'f>, out: &mut Vec<&'f [u8]>) {
    let is_bindable = |default: Option<bun_lint::ast::Expr<'_>>| {
        (default
            .and_then(|it| it.callee())
            .and_then(|it| it.as_ident()))
        .is_some_and(|it| it.bytes() == b"$bindable")
    };
    match pattern.kind() {
        PatKind::Object(props) => {
            for prop in props.iter() {
                let value = prop.value();
                match value.kind() {
                    PatKind::Ident(name) if is_bindable(prop.default()) => out.push(name.bytes()),
                    _ => bindables(value, out),
                }
            }
        }
        PatKind::Array(elements) => {
            for element in elements.iter() {
                let Some(value) = element.pat() else {
                    continue;
                };
                match value.kind() {
                    PatKind::Ident(name) if is_bindable(element.default()) => {
                        out.push(name.bytes())
                    }
                    _ => bindables(value, out),
                }
            }
        }
        PatKind::Missing | PatKind::Ident(_) => {}
    }
}

/// What svelte-eslint-parser finds in a component before Svelte parses it (`extractBlocks`).
struct Parsed<'t> {
    /// The text Svelte parses: the contents of `<template lang="pug">` and other non-HTML templates are blanked to
    /// whitespace, keeping line breaks.
    text: std::borrow::Cow<'t, [u8]>,
    /// The spans of the scripts' contents. A script that doesn't end with `</script>` is markup.
    scripts: Vec<(usize, usize)>,
    /// `ScriptsSourceCode.attrs.lang`: the last script with a value for it decides, nested scripts included.
    lang: Option<&'t [u8]>,
    /// True if the blocks' start tags are read here the same way svelte-eslint-parser reads them. They aren't for a
    /// start tag with an attribute that starts with `{`, a value that starts with `{` and isn't a single mustache of a
    /// name or a path of names ([`start_tag`]), a mustache in `lang`, `context`, `module` or `generics`, non-ASCII
    /// whitespace, a self-closing tag, a template that spells `lang` in another case, or a template with a `{` in a
    /// value.
    is_reproduced: bool,
    /// The positions of script and style start tags that have a mustache or aren't read.
    with_mustaches: Vec<usize>,
    /// The positions of those with a `{` in a value that isn't a mustache.
    with_braces: Vec<usize>,
    /// True if a `<script` is where svelte-eslint-parser doesn't allow a start tag, or is self-closing, so it's left in
    /// the markup.
    may_leave_a_script: bool,
}

fn as_parsed(text: &[u8]) -> Parsed<'_> {
    let mut out = std::borrow::Cow::Borrowed(text);
    let mut scripts = Vec::new();
    let mut script_lang = None;
    let (mut is_reproduced, mut may_leave_a_script) = (true, false);
    let (mut with_mustaches, mut with_braces) = (Vec::new(), Vec::new());
    let mut from = 0;
    while let Some(at) = strings::index_of_char(&text[from..], b'<') {
        let start = from + at as usize;
        from = start + 1;
        let rest = &text[start..];
        if rest.starts_with(b"<!--") {
            from =
                strings::index_of(&rest[4..], b"-->").map_or(text.len(), |it| start + 4 + it + 3);
            continue;
        }
        let Some(tag) = [&b"script"[..], b"style", b"template"]
            .into_iter()
            .find(|tag| {
                let name = rest.get(1..1 + tag.len()).unwrap_or_default();
                let next = rest.get(1 + tag.len()..).unwrap_or_default();
                let is_end = matches!(next.first(), Some(b'>' | b'/')) || is_js_space(next);
                name.eq_ignore_ascii_case(tag) && is_end
            })
        else {
            continue;
        };
        let name_end = start + 1 + tag.len();
        // A template is only a block with a `lang`, unlike a `<Template>` component. However its start tag is read,
        // whether it then closes itself, nothing closes it, or everything up to its `</template>` is skipped: if
        // nothing in there could start another block, the result is the same.
        if tag == b"template" {
            let close = b"</template>";
            let Some(end) = index_of_ignoring_case(&text[name_end..], close) else {
                continue;
            };
            if is_inert_template(text.get(name_end..name_end + end).unwrap_or_default()) {
                from = name_end + end + close.len();
                continue;
            }
        }
        if text.get(name_end) == Some(&b'/') || !is_tag_start(&text[..start]) {
            may_leave_a_script |= tag == b"script";
            // Svelte may still treat it as the top-level block.
            let (has_mustache, has_braces) = match start_tag(text, name_end) {
                Some((attributes, _, has_braces)) => (attributes.iter().any(|it| it.2), has_braces),
                None => (true, false),
            };
            match tag == b"template" {
                true => is_reproduced &= !has_braces,
                false if has_mustache => with_mustaches.push(start),
                false if has_braces => with_braces.push(start),
                false => {}
            }
            continue;
        }
        let Some((attributes, end_of_start, has_braces)) = start_tag(text, name_end) else {
            is_reproduced = false;
            continue;
        };
        if has_braces {
            match tag == b"template" {
                true => {
                    is_reproduced = false;
                    continue;
                }
                false => with_braces.push(start),
            }
        }
        let start_tag = text.get(name_end..end_of_start).unwrap_or_default();
        let has_other_space = (0..start_tag.len()).any(|at| {
            let rest = start_tag.get(at..).unwrap_or_default();
            is_js_space(rest) && !starts_with_space(rest)
        });
        let lang = (attributes.iter()).find(|(name, ..)| name.eq_ignore_ascii_case(b"lang"));
        let mut mustaches = (attributes.iter()).filter(|(.., is_mustache)| *is_mustache);
        let is_read_as_block = |name: &[u8]| {
            let names = [&b"lang"[..], b"context", b"module", b"generics"];
            names.iter().any(|it| name.eq_ignore_ascii_case(it))
        };
        if has_other_space
            || text.get(end_of_start) == Some(&b'/')
            || (tag == b"template" && lang.is_some_and(|(name, ..)| *name != b"lang"))
            || mustaches.clone().any(|(name, ..)| is_read_as_block(name))
        {
            is_reproduced = false;
            continue;
        }
        if tag != b"template" && mustaches.next().is_some() {
            with_mustaches.push(start);
        }
        if text.get(end_of_start) != Some(&b'>') {
            continue;
        }
        let content = end_of_start + 1;
        let close = [b"</", tag, b">"].concat();
        let Some(end) = index_of_ignoring_case(&text[content..], &close).map(|it| content + it)
        else {
            continue;
        };
        from = end + close.len();
        if tag == b"script" {
            scripts.push((content, end));
            for (_, value, _) in attributes.iter().filter(|it| it.0 == b"lang") {
                script_lang = value.or(script_lang);
            }
        }
        let is_foreign = lang.is_some_and(|(_, value, _)| value.is_some_and(|it| it != b"html"));
        if tag == b"template" && is_foreign {
            let blanked = &mut out.to_mut()[content..end];
            for byte in blanked.iter_mut().filter(|it| !matches!(it, b'\n' | b'\r')) {
                *byte = b' ';
            }
        }
    }
    Parsed {
        text: out,
        scripts,
        lang: script_lang,
        is_reproduced,
        with_mustaches,
        with_braces,
        may_leave_a_script,
    }
}

/// True if `text`, which follows a template's name up to its `</template>`, has no block start, no comment that
/// continues past it, and no `lang` attribute with a value, in any case.
fn is_inert_template(text: &[u8]) -> bool {
    let blocks = [&b"<script"[..], b"<style", b"<template"];
    if blocks
        .iter()
        .any(|it| index_of_ignoring_case(text, it).is_some())
    {
        return false;
    }
    let mut rest = text;
    while let Some(at) = strings::index_of(rest, b"<!--") {
        let after = rest.get(at + b"<!--".len()..).unwrap_or_default();
        let Some(end) = strings::index_of(after, b"-->") else {
            return false;
        };
        rest = after.get(end + b"-->".len()..).unwrap_or_default();
    }
    let mut from = 0;
    while let Some(at) = text
        .get(from..)
        .and_then(|it| index_of_ignoring_case(it, b"lang"))
    {
        let at = from + at;
        // A name continues up to `=`, `>` or `\s`, and the next one starts right after a quoted value, so this is a
        // `lang` unless what precedes it is surely part of a longer name.
        let is_name = (at.checked_sub(1).and_then(|it| text.get(it))).is_none_or(|&it| {
            !(it.is_ascii_alphanumeric() || matches!(it, b'-' | b'_' | b':' | b'.'))
        });
        let after = text.get(at + b"lang".len()..).unwrap_or_default();
        if is_name && strings::trim_js_whitespace_start(after).starts_with(b"=") {
            return false;
        }
        from = at + b"lang".len();
    }
    true
}

/// True if `rest` starts with something `\s` matches.
fn is_js_space(rest: &[u8]) -> bool {
    strings::js_whitespace_len(rest) > 0
}

/// svelte-eslint-parser's `isValidStartTagOpenIndex`: `/>\s*$|^\s*$/m` matches the text before a tag.
fn is_tag_start(before: &[u8]) -> bool {
    // ESLint strips the byte order mark before the parser sees the text.
    let before = before.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(before);
    let line_break_len = |rest: &[u8]| match rest {
        [b'\n' | b'\r', ..] => 1,
        [0xE2, 0x80, 0xA8 | 0xA9, ..] => 3,
        _ => 0,
    };
    let reaches_line_end = |mut at: usize| loop {
        let rest = before.get(at..).unwrap_or_default();
        if rest.is_empty() || line_break_len(rest) > 0 {
            return true;
        }
        match strings::js_whitespace_len(rest) {
            0 => return false,
            len => at += len,
        }
    };
    // The positions where `^` matches, and after each `>`.
    let starts = (0..before.len()).filter_map(|at| {
        let rest = before.get(at..).unwrap_or_default();
        match rest.first() {
            Some(b'>') => Some(at + 1),
            _ => Some(at + line_break_len(rest)).filter(|&it| it > at),
        }
    });
    std::iter::once(0).chain(starts).any(reaches_line_end)
}

/// svelte-eslint-parser's `parseAttributes`: the attributes of the start tag whose name ends at `at`, each with its
/// value and whether that's a mustache, the tag's end (at `>`, at `/>`, or at the end of `text`), and whether a value
/// has a `{` that doesn't start it. `None` if a name starts with `{`, or a value starts with `{` and isn't a single
/// mustache of a name or a path of names followed by whitespace, `>` or `/>` ([`end_of_reference`]).
fn start_tag(text: &[u8], mut at: usize) -> Option<(Vec<Attribute<'_>>, usize, bool)> {
    let rest = |at: usize| text.get(at..).unwrap_or_default();
    let (mut attributes, mut has_braces) = (Vec::new(), false);
    loop {
        at = skip_spaces(text, at);
        if ends_start_tag(rest(at)) {
            return Some((attributes, at, has_braces));
        }
        if rest(at).first() == Some(&b'{') {
            return None;
        }
        // `parseAttributeKey`: the first byte is part of the name, whatever it is.
        let name_start = at;
        at += 1;
        while !ends_start_tag(rest(at))
            && !matches!(rest(at), [b'=', ..])
            && !starts_with_space(rest(at))
        {
            at += 1;
        }
        let name = text.get(name_start..at).unwrap_or_default();
        let behind = skip_spaces(text, at);
        if rest(behind).first() != Some(&b'=') {
            attributes.push((name, None, false));
            at = behind;
            continue;
        }
        at = skip_spaces(text, behind + 1);
        if at >= text.len() {
            attributes.push((name, None, false));
            continue;
        }
        // `parseAttributeValue`
        let quote = (rest(at).first().copied()).filter(|it| matches!(it, b'"' | b'\''));
        let body = at + usize::from(quote.is_some());
        let end = match quote {
            Some(quote) => strings::index_of_char(rest(body), quote).map(|it| body + it as usize),
            None => None,
        };
        let (value, end) = match (quote, end) {
            (Some(_), Some(close)) => (text.get(body..close), close + 1),
            // The value includes its opening quote.
            (Some(_), None) => (text.get(at..), text.len()),
            // The first byte is part of the value, whatever it is.
            (None, _) => {
                let mut end = body + 1;
                while !ends_start_tag(rest(end)) && !starts_with_space(rest(end)) {
                    end += 1;
                }
                (text.get(at..end), end)
            }
        };
        // A mustache is only read the same way if it's a name that makes up the whole value and the start tag continues
        // after it. Svelte parses every other `{` in a value too (`read_sequence`), but only in a top-level block's
        // start tag.
        let is_mustache = rest(body).first() == Some(&b'{');
        if is_mustache {
            let behind = end_of_reference(text, body).map(|it| it + usize::from(quote.is_some()));
            let is_alike = behind == Some(end)
                && !rest(end).is_empty()
                && (ends_start_tag(rest(end)) || starts_with_space(rest(end)));
            if !is_alike {
                return None;
            }
        }
        has_braces |= !is_mustache && strings::contains_char(value.unwrap_or_default(), b'{');
        attributes.push((name, Some(value.unwrap_or_default()), is_mustache));
        at = end;
    }
}

/// A start tag's attribute: its name, its value, and whether that's a mustache.
type Attribute<'t> = (&'t [u8], Option<&'t [u8]>, bool);

/// The position after the `}` of the mustache at `at`, if it holds only a name or a path of names, `a` or `a.b.c`,
/// whose first name isn't a reserved word. Then svelte-eslint-parser (`parseAttributeMustache`) and Svelte read the
/// same reference there. Names are ASCII here, and whitespace or comments inside the braces aren't supported.
fn end_of_reference(text: &[u8], at: usize) -> Option<usize> {
    let start = at + 1;
    let mut at = start;
    loop {
        let rest = text.get(at..).unwrap_or_default();
        let len = run(rest, |it| {
            it.is_ascii_alphanumeric() || matches!(it, b'_' | b'$')
        });
        let name = rest.get(..len).unwrap_or_default();
        if name.first().is_none_or(u8::is_ascii_digit) || (at == start && is_reserved_word(name)) {
            return None;
        }
        at += len;
        match text.get(at) {
            Some(b'.') => at += 1,
            Some(b'}') => return Some(at + 1),
            _ => return None,
        }
    }
}

/// True if `name` is a JavaScript reserved word in a module, or `null`, `true` or `false`.
fn is_reserved_word(name: &[u8]) -> bool {
    matches!(
        name,
        b"await"
            | b"break"
            | b"case"
            | b"catch"
            | b"class"
            | b"const"
            | b"continue"
            | b"debugger"
            | b"default"
            | b"delete"
            | b"do"
            | b"else"
            | b"enum"
            | b"export"
            | b"extends"
            | b"false"
            | b"finally"
            | b"for"
            | b"function"
            | b"if"
            | b"implements"
            | b"import"
            | b"in"
            | b"instanceof"
            | b"interface"
            | b"let"
            | b"new"
            | b"null"
            | b"package"
            | b"private"
            | b"protected"
            | b"public"
            | b"return"
            | b"static"
            | b"super"
            | b"switch"
            | b"this"
            | b"throw"
            | b"true"
            | b"try"
            | b"typeof"
            | b"var"
            | b"void"
            | b"while"
            | b"with"
            | b"yield"
    )
}

/// True if a start tag ends where `rest` starts, for svelte-eslint-parser.
fn ends_start_tag(rest: &[u8]) -> bool {
    matches!(rest, [] | [b'>', ..] | [b'/', b'>', ..])
}

fn starts_with_space(rest: &[u8]) -> bool {
    rest.first().is_some_and(u8::is_ascii_whitespace)
}

/// The end of the whitespace starting at `at`.
fn skip_spaces(text: &[u8], at: usize) -> usize {
    at + run(text.get(at..).unwrap_or_default(), |it| {
        it.is_ascii_whitespace()
    })
}

/// The state of [`markup_tokens`]' tokenizer.
#[derive(Copy, Clone)]
enum Markup {
    Text,
    /// After a block's keyword, before its `}`.
    Mustache,
    /// In a start or end tag. `is_style` is true for `<style>`, `is_value_next` after a `=`.
    Tag {
        is_style: bool,
        is_value_next: bool,
    },
    /// In an attribute's quoted value.
    Value {
        quote: u8,
        is_style: bool,
    },
}

/// The number of leading bytes of `rest` that `is_part` holds for.
fn run(rest: &[u8], is_part: impl Fn(u8) -> bool) -> usize {
    rest.iter().take_while(|&&it| is_part(it)).count()
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$') || byte >= 0x80
}

/// The tokens svelte-eslint-parser creates for the markup of the component `text` (its converters and `extractTokens`):
/// element and attribute names, text words, attribute values, the contents of `<style>`, block keywords, HTML comments,
/// and a token for each other character. `markups` holds the markup ranges, in order. Everything in between is code,
/// whose tokens are the program's.
fn markup_tokens(text: &[u8], markups: &[(u32, u32)]) -> Vec<(u32, u32, TokenKind)> {
    let mut out: Vec<(u32, u32, TokenKind)> = Vec::new();
    let mut state = Markup::Text;
    for &(start, end) in markups {
        let end = (end as usize).min(text.len());
        let mut at = (start as usize).min(end);
        while let Some(rest) = text.get(at..end)
            && let Some(&c) = rest.first()
        {
            let mut push = |from: usize, len: usize, kind: TokenKind| {
                out.push(((at + from) as u32, (at + from + len) as u32, kind));
            };
            let len = match state {
                Markup::Value { quote, is_style } => {
                    if c == quote {
                        state = Markup::Tag {
                            is_style,
                            is_value_next: false,
                        };
                        push(0, 1, TokenKind::Punctuator);
                        1
                    } else if matches!(c, b'{' | b'}') {
                        push(0, 1, TokenKind::Punctuator);
                        1
                    } else {
                        let len = run(rest, |it| it != quote && it != b'{');
                        push(0, len, TokenKind::HtmlText);
                        len
                    }
                }
                _ if c.is_ascii_whitespace() => run(rest, |it| it.is_ascii_whitespace()),
                Markup::Tag {
                    is_style,
                    is_value_next,
                } => {
                    state = Markup::Tag {
                        is_style,
                        is_value_next: c == b'=',
                    };
                    match c {
                        b'>' => {
                            state = Markup::Text;
                            push(0, 1, TokenKind::Punctuator);
                            // The style sheet is one token.
                            let content = rest.get(1..).unwrap_or_default();
                            let len = match is_style {
                                true => index_of_ignoring_case(content, b"</style")
                                    .unwrap_or(content.len()),
                                false => 0,
                            };
                            let sheet = content.get(..len).unwrap_or_default();
                            if !sheet.trim_ascii().is_empty() {
                                push(1, len, TokenKind::HtmlText);
                            }
                            1 + len
                        }
                        b'/' | b'=' | b'{' | b'}' => {
                            push(0, 1, TokenKind::Punctuator);
                            1
                        }
                        b'"' | b'\'' => {
                            state = Markup::Value { quote: c, is_style };
                            push(0, 1, TokenKind::Punctuator);
                            1
                        }
                        _ if is_value_next => {
                            let len = run(rest, |it| !it.is_ascii_whitespace() && it != b'>');
                            push(0, len, TokenKind::HtmlText);
                            len
                        }
                        _ => {
                            let len = run(rest, |it| {
                                !it.is_ascii_whitespace()
                                    && !matches!(it, b'=' | b'>' | b'/' | b'{' | b'"' | b'\'')
                            })
                            .max(1);
                            push(0, len, TokenKind::HtmlIdentifier);
                            len
                        }
                    }
                }
                _ if rest.starts_with(b"<!--") => {
                    let len = (rest.get(4..))
                        .and_then(|it| strings::index_of(it, b"-->"))
                        .map_or(rest.len(), |it| it + 7);
                    push(0, len, TokenKind::HtmlComment);
                    len
                }
                _ if c == b'<' => {
                    push(0, 1, TokenKind::Punctuator);
                    let is_end = rest.get(1) == Some(&b'/');
                    if is_end {
                        push(1, 1, TokenKind::Punctuator);
                    }
                    let from = 1 + usize::from(is_end);
                    let after = rest.get(from..).unwrap_or_default();
                    let name = run(after, |it| {
                        !it.is_ascii_whitespace() && !matches!(it, b'/' | b'>' | b'{')
                    });
                    if name > 0 {
                        push(from, name, TokenKind::HtmlIdentifier);
                    }
                    let is_style = after
                        .get(..name)
                        .is_some_and(|it| it.eq_ignore_ascii_case(b"style"));
                    state = Markup::Tag {
                        is_style: !is_end && is_style,
                        is_value_next: false,
                    };
                    from + name
                }
                _ if c == b'{' => {
                    push(0, 1, TokenKind::Punctuator);
                    let after = rest.get(1..).unwrap_or_default();
                    let spaces = run(after, |it| it.is_ascii_whitespace());
                    let name = after.get(spaces..).unwrap_or_default();
                    let keyword = match name.first() {
                        Some(b'#' | b':' | b'/' | b'@') => {
                            run(name, |it| !it.is_ascii_whitespace() && it != b'}')
                        }
                        _ => 0,
                    };
                    if keyword > 0 {
                        push(1 + spaces, keyword, TokenKind::MustacheKeyword);
                        state = Markup::Mustache;
                    }
                    1 + spaces + keyword
                }
                _ if c == b'}' => {
                    state = Markup::Text;
                    push(0, 1, TokenKind::Punctuator);
                    1
                }
                Markup::Mustache => match run(rest, is_word_byte) {
                    0 => {
                        push(0, 1, TokenKind::Punctuator);
                        1
                    }
                    len => {
                        match rest.get(..len).unwrap_or_default() {
                            b"as" => push(0, len, TokenKind::Keyword),
                            b"then" | b"catch" | b"if" => push(0, len, TokenKind::MustacheKeyword),
                            _ => (0..len).for_each(|it| push(it, 1, TokenKind::Identifier)),
                        }
                        len
                    }
                },
                Markup::Text => {
                    let len = run(rest, |it| {
                        !it.is_ascii_whitespace() && it != b'<' && it != b'{'
                    })
                    .max(1);
                    push(0, len, TokenKind::HtmlText);
                    len
                }
            };
            at += len.max(1);
        }
    }
    out
}

fn index_of_ignoring_case(text: &[u8], part: &[u8]) -> Option<usize> {
    (0..text.len()).find(|&at| {
        text.get(at..at + part.len())
            .is_some_and(|it| it.eq_ignore_ascii_case(part))
    })
}

/// The program for the component `text`, whose tree `tree` Svelte built from `parsed`. `None` if it can't be lowered
/// because it's nested too deeply.
fn lower(
    text: &[u8],
    parsed: &Parsed<'_>,
    tree: &Tree<'_>,
    dialect: &Dialect,
    plan: &Plan,
) -> Option<Virtual> {
    let mut lowering = Lowering {
        text,
        parsed: &parsed.text,
        scripts: &parsed.scripts,
        tree,
        out: Virtual {
            text: Vec::with_capacity(text.len() + text.len() / 4),
            segments: Vec::new(),
            original_len: text.len() as u32,
            ..Virtual::default()
        },
        next: 0,
        helper: &dialect.helper,
        plan,
        depth: 0,
        stack: bun_core::StackCheck::init(),
        is_broken: false,
        snippets: Vec::new(),
    };
    // ESLint strips a byte order mark. Here it stays in place, so every offset is a file offset.
    if text.starts_with(b"\xEF\xBB\xBF") {
        lowering.take(3);
    }
    for id in tree.top_level() {
        lowering.node(id);
    }
    lowering.markup(text.len());
    if let Some(generics) = &dialect.generics {
        lowering.generics(generics);
    }
    lowering.out.trailer = lowering.out.text.len() as u32;
    for part in plan.trailer.iter().flatten() {
        match part {
            Part::Glue(code) => lowering.glue(code),
            Part::Copy(span) => lowering.copy(*span),
        }
    }
    if lowering.is_broken {
        return None;
    }
    debug_assert!(lowering.out.holds_for(text));
    Some(lowering.out)
}

/// The maximum nesting depth of markup elements and blocks. Other content of the innermost one doesn't count as a
/// level.
const DEEPEST: u32 = 2000;

struct Lowering<'t, 'a> {
    text: &'t [u8],
    /// The text the tree's names point into: [`Parsed::text`].
    parsed: &'t [u8],
    scripts: &'t [(usize, usize)],
    tree: &'t Tree<'a>,
    out: Virtual,
    /// The next component byte that hasn't been written.
    next: usize,
    helper: &'t [u8],
    plan: &'t Plan,
    depth: u32,
    stack: bun_core::StackCheck,
    /// True if something was in the wrong place, or nested too deeply.
    is_broken: bool,
    /// The position of each snippet's name, in the component and in the program.
    snippets: Vec<(u32, u32)>,
}

impl Lowering<'_, '_> {
    fn glue(&mut self, code: &[u8]) {
        self.out.push(Piece::Glue, code, self.next as u32);
    }

    /// Copies the text at `span`, on one line.
    fn copy(&mut self, span: ast::Span) {
        let bytes = self.text.get(span.start as usize..span.end as usize);
        let bytes = without_line_breaks(bytes.unwrap_or_default());
        self.out.push(Piece::Copy, &bytes, span.start);
    }

    /// `helper(`
    fn call(&mut self) {
        self.glue(self.helper);
        self.glue(b"(");
    }

    /// Writes the source text up to `end` as code.
    fn take(&mut self, end: usize) {
        let end = end.min(self.text.len());
        if end < self.next {
            self.is_broken = true;
            return;
        }
        self.out.push(
            Piece::Original,
            &self.text[self.next..end],
            self.next as u32,
        );
        self.next = end;
    }

    /// Writes the source text up to `end` in a block comment. A `*/` in it gets a glue space.
    fn markup(&mut self, end: usize) {
        let end = end.min(self.text.len());
        if end > self.next {
            self.out.markups.push((self.next as u32, end as u32));
        }
        self.wrap(end, false);
    }

    /// Writes the source text up to `end` in a glue block comment. `is_read` is true for a line comment at the end of a
    /// script, which rules read as written, so the `/` of a `*/` in it gets a [stand-in](Piece::StandIn) where markup
    /// gets a glue space.
    fn wrap(&mut self, end: usize, is_read: bool) {
        let end = end.min(self.text.len());
        if end <= self.next {
            return;
        }
        self.glue(b"/*");
        while let Some(at) = strings::index_of(&self.text[self.next..end], b"*/") {
            self.take(self.next + at + 1);
            if is_read {
                self.out.push(Piece::StandIn, b" ", self.next as u32);
                self.next += 1;
            } else {
                self.glue(b" ");
            }
        }
        self.take(end);
        self.glue(b"*/");
    }

    /// Writes `start` to `end` as code, with markup before it.
    fn code(&mut self, start: usize, end: usize) {
        if start < self.next || end < start {
            self.is_broken = true;
            return;
        }
        self.markup(start);
        self.take(end);
    }

    /// The end of the whitespace after `end`.
    fn behind_spaces(&self, end: u32) -> usize {
        let rest = self.text.get(end as usize..).unwrap_or_default();
        end as usize + (rest.len() - rest.trim_ascii_start().len())
    }

    /// `helper(e);`. The whitespace after it is code too, so a line comment at its end ends there. A sequence stays one
    /// expression, in a template substitution that has nothing around it that rules see: `helper(`${a, b}`);`.
    fn expression(&mut self, e: Expression) {
        match e.kind == ExpressionKind::Sequence {
            true => self.called_with(e, b"`${", b"}`);"),
            false => self.called_with(e, b"", b");"),
        }
    }

    /// `helper(a, b);` for the two functions of a `bind:`, which aren't a sequence ([`is_function_bindings`]).
    fn function_bindings(&mut self, e: Expression) {
        self.called_with(e, b"", b");");
    }

    /// `helper(` and `before`, `e` and the whitespace after it, then `after`.
    fn called_with(&mut self, e: Expression, before: &[u8], after: &[u8]) {
        self.markup(e.outer.start as usize);
        self.call();
        if !before.is_empty() {
            self.glue(before);
        }
        self.code(e.outer.start as usize, self.behind_spaces(e.outer.end));
        self.glue(after);
    }

    /// `helper(name);` for a markup name that's a variable or a member of one.
    fn name(&mut self, name: &[u8]) {
        let Some(span) = ast::span_in(self.parsed, name) else {
            return;
        };
        let is_path = strings::split(name, b".").all(is_identifier);
        if is_path {
            self.called(span);
        }
    }

    /// A directive's name, which svelte-eslint-parser reads as code whatever it is, and requires to be `expected`.
    fn directive_name(&mut self, name: &[u8], expected: Expected) {
        if let Some(span) = ast::span_in(self.parsed, name) {
            self.out.expected.push((span, expected));
            self.called(span);
        }
    }

    /// `span` of the component as the argument of a helper call.
    fn called(&mut self, span: ast::Span) {
        self.markup(span.start as usize);
        self.call();
        self.take(span.end as usize);
        self.glue(b");");
    }

    fn fragment(&mut self, fragment: ast::FragmentId) {
        for &id in self.tree.fragment(fragment) {
            self.node(id);
        }
    }

    /// The node starting here has a scope that stands for `owner`, a tree node or one of its clauses.
    fn scope(&mut self, owner: (Id, Of)) {
        let at = self.out.text.len() as u32;
        self.out.scope_owners.push((at, owner.0, owner.1));
    }

    /// `{` and `}` around the contents of `fragment`, whose scope stands for `owner`.
    fn block(&mut self, fragment: Option<ast::FragmentId>, owner: (Id, Of)) {
        if let Some(fragment) = fragment {
            self.scope(owner);
            self.glue(b"{");
            self.fragment(fragment);
            self.glue(b"}");
        }
    }

    /// `pattern` as code.
    fn pattern(&mut self, pattern: Pattern) {
        let span = pattern.with_annotation();
        self.code(span.start as usize, span.end as usize);
    }

    /// The position of the `}` that ends the tag `id`.
    fn closing_brace(&mut self, id: Id) -> usize {
        let end = self.tree[id].end as usize;
        match end
            .checked_sub(1)
            .filter(|&it| self.text.get(it) == Some(&b'}'))
        {
            Some(brace) => brace,
            None => {
                self.is_broken = true;
                end
            }
        }
    }

    fn node(&mut self, id: Id) {
        let nests = matches!(
            self.tree[id].kind,
            Kind::Element(_)
                | Kind::IfBlock { .. }
                | Kind::EachBlock { .. }
                | Kind::AwaitBlock { .. }
                | Kind::KeyBlock { .. }
                | Kind::SnippetBlock { .. }
        );
        self.depth += u32::from(nests);
        if self.depth > DEEPEST || !self.stack.is_safe_to_recurse() {
            self.is_broken = true;
        } else {
            self.lower_node(id);
        }
        self.depth -= u32::from(nests);
    }

    fn lower_node(&mut self, id: Id) {
        let tree = self.tree;
        match &tree[id].kind {
            Kind::Text { .. } | Kind::Comment { .. } | Kind::StyleSheet { .. } => {}
            Kind::Element(element) => self.element(id, element),
            Kind::ExpressionTag(e) | Kind::HtmlTag(e) | Kind::RenderTag(e) => self.expression(*e),
            // `const /*{@const */x = 1/*}*/;`: svelte-eslint-parser's declaration spans the whole tag.
            Kind::ConstTag(declarator, _) => {
                let brace = self.closing_brace(id);
                self.out.shown.push(self.out.text.len() as u32);
                self.glue(b"const ");
                self.code(declarator.start as usize, brace);
                self.markup(brace + 1);
                self.glue(b";");
            }
            Kind::DeclarationTag(declaration) => {
                let brace = self.closing_brace(id);
                self.code(declaration.start as usize, brace);
                let written = declaration.of(self.text).trim_ascii_end();
                if !written.ends_with(b";") {
                    self.glue(b";");
                }
            }
            Kind::DebugTag(names) => {
                if let (Some(first), Some(last)) = (names.first(), names.last()) {
                    self.markup(first.start as usize);
                    self.call();
                    self.code(first.start as usize, last.end as usize);
                    self.glue(b");");
                }
            }
            Kind::IfBlock {
                test,
                consequent,
                alternate,
                ..
            } => {
                self.expression(*test);
                self.block(Some(*consequent), (id, Of::Node));
                self.block(*alternate, (id, Of::Else));
            }
            Kind::EachBlock {
                expression,
                context,
                index,
                key,
                body,
                fallback,
            } => {
                self.markup(expression.outer.start as usize);
                self.call();
                let end = self.behind_spaces(expression.outer.end);
                self.code(expression.outer.start as usize, end);
                self.glue(b",");
                self.scope((id, Of::Node));
                self.glue(b"(");
                if let Some(context) = context {
                    self.pattern(*context);
                }
                if let Some(index) = index.and_then(|it| ast::span_in(self.parsed, it)) {
                    if context.is_none() {
                        let unused = [self.helper, b"p"].concat();
                        self.glue(&unused);
                    }
                    // `as item, index`: the comma is code, so a fix can remove `, index`.
                    let between = self
                        .text
                        .get(self.next..index.start as usize)
                        .unwrap_or_default();
                    if context.is_some() && between.trim_ascii() == b"," {
                        self.take(index.end as usize);
                    } else {
                        self.markup(index.start as usize);
                        self.glue(b",");
                        self.take(index.end as usize);
                    }
                }
                self.glue(b")=>{");
                if let Some(key) = key {
                    self.expression(*key);
                }
                self.fragment(*body);
                self.glue(b"});");
                self.block(*fallback, (id, Of::Else));
            }
            Kind::AwaitBlock {
                expression,
                value,
                error,
                pending,
                then,
                catch,
            } => {
                self.expression(*expression);
                self.block(*pending, (id, Of::Pending));
                let first_of = |pattern: &Option<Pattern>, fragment: &Option<ast::FragmentId>| {
                    let first =
                        fragment.and_then(|it| tree.fragment(it).first().map(|&it| tree[it].start));
                    pattern
                        .map(|it| it.span.start)
                        .or(first)
                        .unwrap_or(u32::MAX)
                };
                let mut clauses = [(*value, *then, Of::Then), (*error, *catch, Of::Catch)];
                if first_of(&clauses[1].0, &clauses[1].1) < first_of(&clauses[0].0, &clauses[0].1) {
                    clauses.swap(0, 1);
                }
                for (pattern, fragment, of) in clauses {
                    if pattern.is_none() && fragment.is_none() {
                        continue;
                    }
                    self.call();
                    self.scope((id, of));
                    self.glue(b"(");
                    if let Some(pattern) = pattern {
                        self.pattern(pattern);
                    }
                    self.glue(b")=>{");
                    if let Some(fragment) = fragment {
                        self.fragment(fragment);
                    }
                    self.glue(b"});");
                }
            }
            Kind::KeyBlock {
                expression,
                fragment,
            } => {
                self.expression(*expression);
                self.block(Some(*fragment), (id, Of::Node));
            }
            Kind::SnippetBlock {
                expression: name,
                end_of_parameters,
                body,
            } => {
                self.markup(name.start as usize);
                self.scope((id, Of::Node));
                self.glue(b"function ");
                (self.snippets).push((name.start, self.out.text.len() as u32));
                self.code(name.start as usize, *end_of_parameters as usize);
                self.glue(b"{");
                self.fragment(*body);
                self.glue(b"}");
            }
            Kind::Script {
                attributes,
                content,
                ..
            } => {
                let is_module = attributes.iter().any(|&it| match &tree[it].kind {
                    Kind::Attribute {
                        name: b"context",
                        value,
                    } => text_of(tree, value) == Some(b"module"),
                    _ => false,
                });
                let (start, end) = (content.start as usize, content.end as usize);
                if !self.scripts.contains(&(start, end)) {
                    return;
                }
                self.markup(start);
                let virtual_start = self.out.text.len() as u32;
                let comment = (self.plan.line_comments.iter())
                    .find(|&&it| start <= it as usize && (it as usize) < end);
                // svelte-eslint-parser trims the whitespace after the scripts' last code, and writes `\n;` in its
                // place, before the markup's code. Nodes that end there don't include it. Each script with code ends
                // here too, because the markup's code may follow it: [`Context::refusal_of_scripts`] has rejected any
                // component in which a statement continues into the next script. The last statement has ended before a
                // line comment that ends the script.
                let is_last = self.scripts.last() == Some(&(start, end));
                let code_end = |end: usize| {
                    let code = self.text.get(start..end).unwrap_or_default();
                    start + strings::trim_js_whitespace_end(code).len()
                };
                let (code_end, before_comment) =
                    (code_end(end), comment.map(|&it| code_end(it as usize)));
                let is_ended = is_last || code_end > start;
                match comment {
                    // A glue block comment around it: `/*// ..*/`.
                    Some(&comment) => {
                        if let Some(before) = before_comment.filter(|_| is_ended && !is_last) {
                            self.take(before);
                            self.glue(b";");
                        }
                        self.take(comment as usize);
                        let start = self.out.text.len() as u32 + 2;
                        self.wrap(code_end, true);
                        let end = (self.out.text.len() as u32).saturating_sub(2).max(start);
                        self.out.line_comments.push(Span::new(start, end));
                    }
                    None => self.take(code_end),
                }
                if is_last || (is_ended && comment.is_none()) {
                    self.glue(b";");
                }
                self.take(end);
                let virtual_end = self.out.text.len() as u32;
                (self.out.scripts).push((Span::new(virtual_start, virtual_end), is_module));
            }
            Kind::Attribute { .. }
            | Kind::SpreadAttribute(_)
            | Kind::AttachTag(_)
            | Kind::Directive { .. }
            | Kind::StyleDirective { .. } => self.attribute(id),
        }
    }

    fn attribute(&mut self, id: Id) {
        let tree = self.tree;
        match &tree[id].kind {
            Kind::Attribute { value, .. } => {
                for &part in value.parts() {
                    if let Kind::ExpressionTag(e) = &tree[part].kind {
                        self.expression(*e);
                    }
                }
            }
            Kind::SpreadAttribute(e) => {
                let start = tree[id].start as usize;
                let before = self
                    .text
                    .get(start..e.outer.start as usize)
                    .unwrap_or_default();
                let Some(dots) = strings::index_of(before, b"...") else {
                    return self.expression(*e);
                };
                self.markup(start + dots);
                self.call();
                self.glue(b"{");
                self.code(start + dots, self.behind_spaces(e.outer.end));
                self.glue(b"});");
            }
            Kind::AttachTag(e) => self.expression(*e),
            Kind::Directive {
                kind,
                name,
                expression,
                ..
            } => {
                // Svelte has an `Identifier` for the name in `bind:x` and `class:x`, which is checked after parsing.
                let shorthand =
                    expression.filter(|it| Some(it.span) == ast::span_in(self.parsed, name));
                if let Some(e) = shorthand
                    && matches!(kind, DirectiveKind::Bind | DirectiveKind::Class)
                {
                    self.out.expected.push((e.span, Expected::Identifier));
                }
                match kind {
                    DirectiveKind::Use | DirectiveKind::Animate | DirectiveKind::Transition(..) => {
                        let types: &[&str] = match kind {
                            DirectiveKind::Use => &["Identifier", "MemberExpression"],
                            _ => &["Identifier"],
                        };
                        self.directive_name(name, Expected::Js(types));
                        if let Some(e) = expression {
                            self.expression(*e);
                        }
                    }
                    // A name is read and written, even though nothing assigns it: `convertBindingDirective`.
                    DirectiveKind::Bind => {
                        if let Some(e) = expression {
                            if e.kind == ExpressionKind::Identifier {
                                self.out.binds.push(e.span.start);
                            }
                            match is_function_bindings(self.parsed, e) {
                                true => self.function_bindings(*e),
                                false => self.expression(*e),
                            }
                        }
                    }
                    DirectiveKind::Class | DirectiveKind::On => {
                        if let Some(e) = expression {
                            self.expression(*e);
                        }
                    }
                    // The parameters of the element's callback.
                    DirectiveKind::Let => {}
                }
            }
            Kind::StyleDirective { name, value, .. } => match value {
                Value::True => self.directive_name(name, Expected::StyleKey),
                _ => {
                    for &part in value.parts() {
                        if let Kind::ExpressionTag(e) = &tree[part].kind {
                            self.expression(*e);
                        }
                    }
                }
            },
            _ => {}
        }
    }

    fn element(&mut self, id: Id, element: &ast::Element<'_>) {
        let tree = self.tree;
        if element.kind == ElementKind::Component {
            self.name(element.name);
        }
        // What `let:` declares: the name, or the pattern in its value.
        let lets: Vec<ast::Span> = (element.attributes.iter())
            .filter_map(|&it| match &tree[it].kind {
                Kind::Directive {
                    kind: DirectiveKind::Let,
                    name,
                    expression,
                    ..
                } => expression
                    .map(|it| it.span)
                    .or_else(|| ast::span_in(self.parsed, name)),
                _ => None,
            })
            .collect();
        let children = tree.fragment(element.fragment);
        let declares = children.iter().any(|&it| {
            matches!(
                tree[it].kind,
                Kind::ConstTag(..) | Kind::DeclarationTag(_) | Kind::SnippetBlock { .. }
            )
        });
        for &it in &element.attributes {
            if let Kind::Directive {
                kind: DirectiveKind::Let,
                expression: Some(e),
                ..
            } = &tree[it].kind
            {
                self.out.lets.push((e.span.start, e.span.end));
            }
        }
        if !lets.is_empty() {
            self.call();
            self.scope((id, Of::Node));
            self.glue(b"(");
            for (span, at) in lets.iter().zip(0..) {
                if at > 0 {
                    self.glue(b",");
                }
                self.copy(*span);
            }
            self.glue(b")=>{");
        } else if declares {
            self.scope((id, Of::Node));
            self.glue(b"{");
        }
        // In the scope of the element's declarations, as svelte-eslint-parser has them (`nestBlock`).
        let mut attributes: Vec<Id> = element.attributes.clone();
        attributes.extend(element.this_definition);
        bun_lint::utils::sort::sort_by_key(&mut attributes, |&it| tree[it].start);
        for &attribute in &attributes {
            self.attribute(attribute);
        }
        // A snippet passed to a component is used: `analyzeSnippetsScope`.
        let gives_snippets = matches!(
            element.kind,
            ElementKind::Component | ElementKind::SvelteComponent | ElementKind::SvelteBoundary
        );
        for &child in children {
            self.node(child);
            if let Kind::SnippetBlock {
                expression: name, ..
            } = &tree[child].kind
                && gives_snippets
                && let Some(&(_, at)) = self.snippets.iter().find(|it| it.0 == name.start)
            {
                self.out.given.push(at);
            }
        }
        if !lets.is_empty() {
            self.glue(b"});");
        } else if declares {
            self.glue(b"}");
        }
    }

    /// `type T = Constraint;` for each parameter of `generics`, as svelte-eslint-parser declares them
    /// (`addGenericTypeAliasDeclaration`), plus an unnamed alias for the default.
    fn generics(&mut self, generics: &GenericsSyntax) {
        let helper = self.helper;
        for (parameter, number) in generics.parameters.iter().zip(0..) {
            self.glue(b"type ");
            self.copy_without_comments(parameter.declared, &generics.comments);
            self.glue(b" = ");
            match parameter.constraint {
                Some(constraint) => self.copy_without_comments(constraint, &generics.comments),
                None => self.glue(b"unknown"),
            }
            self.glue(b";");
            if let Some(default) = parameter.default {
                let number = format!("d{number} = ");
                self.glue(&[b"type ", helper, number.as_bytes()].concat());
                self.copy_without_comments(default, &generics.comments);
                self.glue(b";");
            }
        }
    }

    /// Copies the code at `span`, with a glue space for each of `comments` in it, because a line comment would end the
    /// copy.
    fn copy_without_comments(&mut self, span: ast::Span, comments: &[ast::Span]) {
        let mut start = span.start;
        for comment in comments
            .iter()
            .filter(|it| span.start <= it.start && it.end <= span.end)
        {
            self.copy(ast::Span {
                start,
                end: comment.start,
            });
            self.glue(b" ");
            start = comment.end;
        }
        self.copy(ast::Span {
            start,
            end: span.end,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lowered(text: &[u8]) -> Virtual {
        let parsed = as_parsed(text);
        let tree = bun_format::svelte::parse_tree(
            &parsed.text,
            crate::fmt::parse_parts,
            crate::fmt::parse_javascript,
        )
        .ok()
        .unwrap_or_default();
        let typescript = Json::String(b"@typescript-eslint/parser".to_vec());
        let language = LanguageOptions {
            parser_options: Json::Object(vec![(b"parser".to_vec(), typescript)]),
            ..LanguageOptions::default()
        };
        let dialect = Dialect::of((&tree, parsed.lang), (text, &Json::Null), &language, &[]);
        lower(text, &parsed, &tree, &dialect, &Plan::default()).unwrap_or_default()
    }

    #[test]
    fn every_byte_once_in_order_on_its_line() {
        let components: [&[u8]; 5] = [
            b"\xEF\xBB\xBF<script>\r\n  let a = 1; // c\r\n</script>\r\n{a}<p class:b>{@html c}</p>",
            b"{#each xs as x, i (x.id)}<A let:item={{ y }} {...z}>{y}</A>{:else}*/{/each}",
            b"<style>/* a */</style>{#await p then v}{v}{:catch e}{e}{/await}{#snippet s(q)}{q}{/snippet}",
            "{@const \u{2028}}<p>caf\u{e9}</p>".as_bytes(),
            b"<script lang=\"ts\" generics=\"T extends A< // c\n B>\">\n</script>\n<template lang=\"pug\">\n  p(\"{...o}\")\n</template>",
        ];
        for (text, at) in components.into_iter().zip(0..) {
            let lowered = lowered(text);
            assert!(lowered.holds_for(text), "component {at}");
            let lines = |text: &[u8]| {
                bun_lint::source::LineBreaks::EcmaScript
                    .line_starts(text)
                    .line_at(text.len() as u32)
                    .0
            };
            assert_eq!(lines(&lowered.text), lines(text));
        }
    }
}
