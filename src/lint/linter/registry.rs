//! Rule lookup by name.

#[path = "deprecated_data.rs"]
mod deprecated;

use super::config::oxlint_category;
use crate::languages::Language;
use crate::rule::{Meta, Plugin};
use crate::runner::RuleEntry;
use bun_core::strings;
pub use deprecated::Deprecated;
use std::borrow::Cow;

/// Every rule that can be configured.
pub struct Registry {
    /// Sorted by plugin and name.
    rules: Vec<&'static RuleEntry>,
    /// typescript-eslint's rules, each keyed by the core rule it extends, or by its own name if it extends none. Sorted
    /// by key, and keys are unique.
    extensions: Vec<(&'static str, &'static RuleEntry)>,
    native_plugins: NativePlugins,
    languages: &'static [&'static dyn Language],
}

fn core_rule_of(extension: &Meta) -> &'static str {
    extension.extends_base_rule.unwrap_or(extension.name)
}

/// Selects which of the plugins an ESLint config loads from a package are replaced by the built-in rules.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub enum NativePlugins {
    /// Every plugin that's built in.
    #[default]
    All,
    None,
    /// Listed by the prefix configs use: `react-hooks`, `@typescript-eslint`.
    Only(Vec<Box<[u8]>>),
}

impl NativePlugins {
    /// The names [`NativePlugins::Only`] accepts.
    pub fn names() -> impl Iterator<Item = &'static str> {
        let replaceable = Plugin::ALL.iter().filter(|it| it.follows().is_some());
        replaceable.map(|it| it.prefix())
    }

    /// Parses `true`, `false`, or a comma-separated list of names. Returns `Err` with the first name that isn't one of
    /// [`NativePlugins::names`].
    pub fn parse(text: &[u8]) -> Result<NativePlugins, &[u8]> {
        match text {
            b"true" => return Ok(NativePlugins::All),
            b"false" => return Ok(NativePlugins::None),
            _ => {}
        }
        let names = strings::split(text, b",").map(<[u8]>::trim_ascii);
        let names = names.filter(|name| !name.is_empty());
        let names =
            names.map(
                |name| match NativePlugins::names().any(|it| it.as_bytes() == name) {
                    true => Ok(Box::from(name)),
                    false => Err(name),
                },
            );
        Ok(NativePlugins::Only(names.collect::<Result<_, _>>()?))
    }
}

/// The kinds of config a built-in rule is available with.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Modes {
    /// No ESLint or oxlint config.
    pub native: bool,
    pub eslint: bool,
    pub oxlint: bool,
}

/// Returned by [`Registry::names_of`].
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Names {
    /// The ID that reports print, except in oxlint's output formats.
    pub id: Vec<u8>,
    /// Other names that work in bunfig.toml and in comments when there's no ESLint or oxlint config.
    pub aliases: Vec<Vec<u8>>,
    pub modes: Modes,
}

/// Returned by [`Registry::why_missing`].
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Missing {
    /// A formatting rule. `bun fmt` handles those.
    Formatting,
    /// The plugin is known, but [none of its rules are built in](Plugin::has_no_rules).
    PluginHasNoRules(Plugin),
    /// No such rule. Holds the closest rule name, if any is close enough.
    Unknown(Option<Vec<u8>>),
}

fn rule_id(prefix: &str, name: &str) -> Vec<u8> {
    match prefix {
        "" => name.into(),
        prefix => [prefix, "/", name].concat().into(),
    }
}

/// ESLint's `conf/replacements.json`: removed rules and their replacements.
const REPLACEMENTS: &[(&str, &str)] = &[
    ("generator-star", "generator-star-spacing"),
    ("global-strict", "strict"),
    (
        "no-arrow-condition",
        "no-confusing-arrow, no-constant-condition",
    ),
    ("no-comma-dangle", "comma-dangle"),
    ("no-empty-class", "no-empty-character-class"),
    ("no-empty-label", "no-labels"),
    ("no-extra-strict", "strict"),
    ("no-reserved-keys", "quote-props"),
    ("no-space-before-semi", "semi-spacing"),
    ("no-wrap-func", "no-extra-parens"),
    ("space-after-function-name", "space-before-function-paren"),
    ("space-after-keywords", "keyword-spacing"),
    (
        "space-before-function-parentheses",
        "space-before-function-paren",
    ),
    ("space-before-keywords", "keyword-spacing"),
    (
        "space-in-brackets",
        "object-curly-spacing, array-bracket-spacing, computed-property-spacing",
    ),
    ("space-return-throw-case", "keyword-spacing"),
    ("space-unary-word-ops", "space-unary-ops"),
    ("spaced-line-comment", "spaced-comment"),
];

/// oxlint's `TYPESCRIPT_COMPATIBLE_ESLINT_RULES`: the ESLint rules that understand TypeScript in oxlint. They exist
/// only in its `eslint` plugin, and `typescript/no-unused-vars` is an alias for `no-unused-vars` whether or not the
/// `typescript` plugin is on. Sorted.
const TYPESCRIPT_COMPATIBLE_ESLINT_RULES: [&[u8]; 18] = [
    b"class-methods-use-this",
    b"default-param-last",
    b"init-declarations",
    b"max-params",
    b"no-array-constructor",
    b"no-dupe-class-members",
    b"no-empty-function",
    b"no-invalid-this",
    b"no-loop-func",
    b"no-loss-of-precision",
    b"no-magic-numbers",
    b"no-redeclare",
    b"no-restricted-imports",
    b"no-shadow",
    b"no-unused-expressions",
    b"no-unused-vars",
    b"no-use-before-define",
    b"no-useless-constructor",
];

/// Rules that typescript-eslint extends and that oxlint has only in its `typescript` plugin.
const ONLY_IN_TYPESCRIPT_IN_OXLINT: [&[u8]; 2] = [b"consistent-return", b"dot-notation"];

/// oxlint's plugins under its own names, in the order it searches them for a rule written without a plugin prefix.
const OXLINT_PLUGINS: [(Plugin, &[u8]); 13] = [
    (Plugin::Eslint, b"eslint"),
    (Plugin::Import, b"import"),
    (Plugin::Jest, b"jest"),
    (Plugin::JsxA11y, b"jsx-a11y"),
    (Plugin::Nextjs, b"nextjs"),
    (Plugin::Node, b"node"),
    (Plugin::Oxc, b"oxc"),
    (Plugin::Promise, b"promise"),
    (Plugin::React, b"react"),
    (Plugin::ReactPerf, b"react-perf"),
    (Plugin::TypeScript, b"typescript"),
    (Plugin::Unicorn, b"unicorn"),
    (Plugin::Vitest, b"vitest"),
];

/// oxlint's `is_eslint_rule_adapted_to_typescript`.
fn is_eslint_rule_adapted_to_typescript(name: &[u8]) -> bool {
    TYPESCRIPT_COMPATIBLE_ESLINT_RULES
        .binary_search(&name)
        .is_ok()
}

/// oxlint's `normalizePluginName`. Used on a JavaScript plugin's name and on the plugin prefix of a rule name:
/// `eslint-plugin-a` and `oxlint-plugin-a` become `a`, `@b/eslint-plugin` becomes `@b`, `@b/eslint-plugin-a` becomes
/// `@b/a`.
pub fn normalize_plugin_name(name: &[u8]) -> Cow<'_, [u8]> {
    const PREFIXES: [&[u8]; 2] = [b"eslint-plugin", b"oxlint-plugin"];
    let Some((scope, rest)) = strings::split_once_char(name, b'/') else {
        let mut stripped =
            (PREFIXES.iter()).filter_map(|it| name.strip_prefix(*it)?.strip_prefix(b"-"));
        return Cow::Borrowed(stripped.next().unwrap_or(name));
    };
    for prefix in PREFIXES {
        match rest.strip_prefix(prefix) {
            Some(b"") => return Cow::Borrowed(scope),
            Some([b'-', rest @ ..]) => return Cow::Owned([scope, b"/", rest].concat()),
            _ => {}
        }
    }
    Cow::Borrowed(name)
}

/// Maps any alias of a built-in oxlint plugin to its canonical name, like oxlint's `LintPlugins::try_from`. Any other
/// name belongs to a JavaScript plugin and is returned as [`normalize_plugin_name`] normalizes it.
pub fn canonical_oxlint_plugin(name: &[u8]) -> Cow<'_, [u8]> {
    let name = match normalize_plugin_name(name) {
        Cow::Borrowed(name) => name,
        owned => return owned,
    };
    Cow::Borrowed(match name {
        b"react-hooks" | b"react_hooks" => &b"react"[..],
        b"typescript-eslint" | b"typescript_eslint" | b"@typescript-eslint" => b"typescript",
        b"deepscan" => b"oxc",
        b"import-x" => b"import",
        b"jsx_a11y" | b"jsx-a11y-x" | b"jsx_a11y-x" => b"jsx-a11y",
        b"react_perf" => b"react-perf",
        // `unalias_plugin_name`
        b"@next/next" | b"@next" => b"nextjs",
        name => name,
    })
}

/// Builds the key for rule `name` in `plugin`, which must be a name returned by [`canonical_oxlint_plugin`]. `eslint`
/// rules get no prefix.
fn oxlint_key(plugin: &[u8], name: &[u8]) -> Vec<u8> {
    match plugin {
        b"eslint" => name.to_vec(),
        plugin => [plugin, b"/", name].concat(),
    }
}

/// True if oxlint has a rule `name` in `plugin`.
fn is_in_oxlint(plugin: Plugin, name: &[u8]) -> bool {
    std::str::from_utf8(name).is_ok_and(|name| oxlint_category(plugin, name).is_some())
}

/// True if oxlint has a rule whose [`oxlint_rule_key`] is `key`.
pub(crate) fn is_oxlint_rule_key(key: &[u8]) -> bool {
    let (prefix, name) = match parse_rule_id(key) {
        (b"", name) => (&b"eslint"[..], name),
        other => other,
    };
    (OXLINT_PLUGINS.iter()).any(|it| it.1 == prefix && is_in_oxlint(it.0, name))
}

/// The canonical key for the rule an `.oxlintrc.json` calls `id`. Mirrors oxlint's `parse_rule_key` and
/// `transform_rule_and_plugin_name`. Every alias of a rule maps to the same key, so the last setting wins across
/// aliases: `no-unused-vars`, `eslint/no-unused-vars`, `typescript/no-unused-vars` and
/// `@typescript-eslint/no-unused-vars`; `no-explicit-any` and `typescript/no-explicit-any`;
/// `react-hooks/rules-of-hooks`, `react/rules-of-hooks` and `rules-of-hooks`.
pub fn oxlint_rule_key(id: &[u8]) -> Vec<u8> {
    let (prefix, name) = parse_rule_id(id);
    let plugin = match prefix {
        b"" => Cow::Borrowed(
            (OXLINT_PLUGINS.iter())
                .find(|it| is_in_oxlint(it.0, name))
                .map_or(&b"eslint"[..], |it| it.1),
        ),
        prefix => canonical_oxlint_plugin(prefix),
    };
    match &*plugin {
        b"typescript" if is_eslint_rule_adapted_to_typescript(name) => name.to_vec(),
        plugin => oxlint_key(plugin, name),
    }
}

/// The [`oxlint_rule_key`]s that oxlint's `-A`, `-W` and `-D` select for `name`. Without a plugin prefix, that's every
/// rule with that name. With a prefix, it's only the rule oxlint has in that plugin. Aliases don't work here, so
/// `typescript/no-unused-vars` and `eslint/no-explicit-any` select nothing.
pub fn oxlint_filter_keys(name: &[u8]) -> Vec<Vec<u8>> {
    let (prefix, rule) = match strings::index_of_char_usize(name, b'/') {
        Some(slash) => (&name[..slash], &name[slash + 1..]),
        None => (&b""[..], name),
    };
    if !prefix.is_empty() {
        let key = oxlint_key(&canonical_oxlint_plugin(prefix), rule);
        return match oxlint_rule_key(&key) == key {
            true => vec![key],
            false => Vec::new(),
        };
    }
    let keys: Vec<Vec<u8>> = (OXLINT_PLUGINS.iter())
        .filter(|it| is_in_oxlint(it.0, rule))
        .map(|it| oxlint_key(it.1, rule))
        .collect();
    match keys.is_empty() {
        true => vec![rule.to_vec()],
        false => keys,
    }
}

/// oxlint's category for the rule whose [`oxlint_rule_key`] is `key`.
pub fn oxlint_category_of_key(key: &[u8]) -> Option<&'static str> {
    let (prefix, name) = parse_rule_id(key);
    oxlint_category(
        Plugin::from_oxlint_prefix(prefix)?,
        std::str::from_utf8(name).ok()?,
    )
}

/// ESLint's `parseRuleId`. Returns the plugin name (empty for a core rule) and the rule's name within that plugin.
pub fn parse_rule_id(id: &[u8]) -> (&[u8], &[u8]) {
    let slash = match id.first() {
        Some(b'@') => strings::last_index_of_char(id, b'/'),
        _ => strings::index_of_char_usize(id, b'/'),
    };
    match slash {
        Some(slash) => (&id[..slash], &id[slash + 1..]),
        None => (b"", id),
    }
}

impl Registry {
    /// `lists` holds the `RULES` of each crate that defines rules.
    pub fn new(lists: &[&'static [RuleEntry]]) -> Registry {
        let mut rules: Vec<_> = lists.iter().flat_map(|list| list.iter()).collect();
        crate::utils::sort::sort_by_key(&mut rules, |it| (it.meta.plugin as u8, it.meta.name));
        // `usedDeprecatedRules` is built from the table, so every deprecated rule needs an entry there.
        debug_assert!(
            (rules.iter().map(|it| it.meta))
                .filter(|it| it.is_deprecated && !it.follows_oxlint)
                .all(|it| deprecated_rule(&super::RuleId::Known(it).to_vec()).is_some())
        );
        let typescript_rules = (rules.iter()).filter(|it| it.meta.plugin == Plugin::TypeScript);
        let mut extensions: Vec<_> = typescript_rules
            .map(|it| (core_rule_of(it.meta), *it))
            .collect();
        crate::utils::sort::sort_by_key(&mut extensions, |it| it.0);
        extensions.dedup_by_key(|it| it.0);
        Registry {
            rules,
            extensions,
            native_plugins: NativePlugins::All,
            languages: &[],
        }
    }

    /// `languages` are the languages the registered rules apply to.
    pub fn with_languages(mut self, languages: &'static [&'static dyn Language]) -> Registry {
        self.languages = languages;
        self
    }

    /// The language that `plugin` exports as `name`.
    pub fn language(&self, plugin: Plugin, name: &[u8]) -> Option<&'static dyn Language> {
        let is_match = |it: &&&dyn Language| {
            it.plugin() == plugin && it.names().iter().any(|it| it.as_bytes() == name)
        };
        self.languages.iter().find(is_match).copied()
    }

    pub fn with_native_plugins(mut self, which: NativePlugins) -> Registry {
        self.native_plugins = which;
        self
    }

    /// True if the built-in rules may replace the plugin an ESLint config registers as `prefix`, even though the config
    /// loads the package. Core rules don't come from a package, so they're always built in.
    pub fn replaces_plugin(&self, prefix: &[u8]) -> bool {
        matches!(prefix, b"" | b"@")
            || match &self.native_plugins {
                NativePlugins::All => true,
                NativePlugins::None => false,
                NativePlugins::Only(names) => names.iter().any(|it| **it == *prefix),
            }
    }

    pub fn all(&self) -> &[&'static RuleEntry] {
        &self.rules
    }

    pub fn get(&self, plugin: Plugin, name: &[u8]) -> Option<&'static RuleEntry> {
        let key = (plugin as u8, name);
        let at = self
            .rules
            .binary_search_by(|it| (it.meta.plugin as u8, it.meta.name.as_bytes()).cmp(&key));
        Some(self.rules[at.ok()?])
    }

    /// If `id` is an extra instance of a rule under a name the config picked (`no-restricted-syntax/<name>`), returns
    /// that rule.
    pub fn base_of(&self, id: &[u8]) -> Option<&'static RuleEntry> {
        let (prefix, name) = parse_rule_id(id);
        match prefix == b"no-restricted-syntax" && !name.is_empty() {
            true => self.get(Plugin::Eslint, prefix),
            false => None,
        }
    }

    /// A rule's index in [`Registry::all`].
    pub fn index_of(&self, entry: &RuleEntry) -> Option<usize> {
        self.index_of_meta(entry.meta)
    }

    pub(super) fn index_of_meta(&self, meta: &Meta) -> Option<usize> {
        let key = (meta.plugin as u8, meta.name);
        self.rules
            .binary_search_by(|it| (it.meta.plugin as u8, it.meta.name).cmp(&key))
            .ok()
    }

    /// Like [`Registry::get`], with two differences. With `prefers_typescript` (set for an oxlint config), an ESLint
    /// rule that typescript-eslint extends and that understands TypeScript in oxlint resolves to the extension. Without
    /// it, rules that only oxlint has aren't found.
    pub fn get_preferring(
        &self,
        plugin: Plugin,
        name: &[u8],
        prefers_typescript: bool,
    ) -> Option<&'static RuleEntry> {
        if prefers_typescript
            && plugin == Plugin::Eslint
            && (is_eslint_rule_adapted_to_typescript(name)
                || ONLY_IN_TYPESCRIPT_IN_OXLINT.contains(&name))
            && let Some(extension) = self.get(Plugin::TypeScript, name)
            && extension.meta.extends_base_rule.is_some()
        {
            return Some(extension);
        }
        let found = self.get(plugin, name).or_else(|| match plugin {
            // oxlint merges `react-hooks` into `react`.
            Plugin::React if prefers_typescript => self.get(Plugin::ReactHooks, name),
            _ => None,
        });
        found.filter(|it| prefers_typescript || !it.meta.follows_oxlint)
    }

    /// Like [`Registry::find`], but looks the rule up with [`Registry::get_preferring`].
    pub fn find_preferring(
        &self,
        id: &[u8],
        prefers_typescript: bool,
    ) -> Option<&'static RuleEntry> {
        let (prefix, name) = parse_rule_id(id);
        let plugin = match prefers_typescript {
            true => Plugin::from_oxlint_prefix(prefix),
            false => Plugin::from_prefix(prefix),
        };
        self.get_preferring(plugin?, name, prefers_typescript)
    }

    /// Looks up `id` when there's no ESLint or oxlint config. Finds every built-in rule under every
    /// [spelling](Plugin::spellings) of its plugin. If an ESLint plugin and oxlint both have the rule, the plugin's
    /// version wins.
    pub fn find_by_any_name(&self, id: &[u8]) -> Option<&'static RuleEntry> {
        let (prefix, name) = parse_rule_id(id);
        let found = Plugin::spelled(prefix).filter_map(|it| self.get(it, name));
        found.min_by_key(|it| it.meta.follows_oxlint)
    }

    /// If `meta` is a core rule with a typescript-eslint version, or that version, returns both (core rule first).
    /// Without an ESLint or oxlint config they act as one rule. The core rule runs on JavaScript and the other on
    /// TypeScript.
    pub fn pair_of(&self, meta: &Meta) -> Option<(&'static RuleEntry, &'static RuleEntry)> {
        let extension = match meta.plugin {
            Plugin::TypeScript => self.get(Plugin::TypeScript, meta.name.as_bytes()),
            Plugin::Eslint => {
                let at = self.extensions.binary_search_by_key(&meta.name, |it| it.0);
                at.ok()
                    .and_then(|at| self.extensions.get(at))
                    .map(|it| it.1)
            }
            _ => None,
        }?;
        let base = self.get(Plugin::Eslint, core_rule_of(extension.meta).as_bytes())?;
        Some((base, extension))
    }

    /// Returns the names of `meta`'s rule. If [`Registry::find_by_any_name`] prefers another version of the rule,
    /// returns that version's names.
    pub fn names_of(&self, meta: &Meta) -> Names {
        let own = rule_id(meta.plugin.prefix(), meta.name);
        let meta = self.find_by_any_name(&own).map_or(meta, |it| it.meta);
        let prefixes = meta.plugin.spellings().iter();
        let mut names = prefixes.map(|it| rule_id(it, meta.name));
        let id = names.next().unwrap_or(own);
        Names {
            modes: Modes {
                native: self.find_by_any_name(&id).is_some(),
                eslint: self.find_preferring(&id, false).is_some(),
                oxlint: self.find_preferring(&id, true).is_some(),
            },
            aliases: names.collect(),
            id,
        }
    }

    /// Explains why [`Registry::find_by_any_name`] didn't find `id`.
    pub fn why_missing(&self, id: &[u8]) -> Missing {
        let (prefix, name) = parse_rule_id(id);
        let eslint_id = if prefix == b"eslint" { name } else { id };
        if formatting_rule(eslint_id).is_some() || prefix.starts_with(b"@stylistic") {
            return Missing::Formatting;
        }
        if let Some(plugin) = Plugin::spelled(prefix).find(|it| it.has_no_rules()) {
            return Missing::PluginHasNoRules(plugin);
        }
        // The rule name has to be close. Keep the user's plugin prefix if it's close to a real spelling. Otherwise, if
        // the name matches exactly or no prefix was typed, suggest the ID that reports print.
        let distance = |a: &[u8], b: &str| strings::edit_distance(a.iter().copied(), b.as_bytes());
        let is_close = |distance: usize, typed: &[u8]| distance <= typed.len().max(3) / 3;
        let close = self.rules.iter().flat_map(|it| {
            let other = it.meta.name;
            let name_distance = Some(distance(name, other)).filter(|it| is_close(*it, name));
            let prefixes = it.meta.plugin.spellings().iter().enumerate();
            prefixes.filter_map(move |(nth, it)| {
                let prefix_distance = match prefix {
                    b"" => 0,
                    prefix => distance(prefix, it),
                };
                let prefix_is_close = !prefix.is_empty() && is_close(prefix_distance, prefix);
                let is_canonical_prefix =
                    nth == 0 && (name_distance == Some(0) || prefix.is_empty());
                (prefix_is_close || is_canonical_prefix)
                    .then_some((name_distance? + prefix_distance, rule_id(it, other)))
            })
        });
        Missing::Unknown(close.min_by_key(|it| it.0).map(|it| it.1))
    }

    /// Looks up the rule a config or comment calls `id`: `no-debugger`, `@typescript-eslint/no-explicit-any`. Also
    /// accepts oxlint's names for the same plugins: `eslint/no-debugger`, `typescript/no-explicit-any`,
    /// `typescript-eslint/no-explicit-any`, `react/rules-of-hooks`, `node/no-unsupported-features/es-syntax`.
    pub fn find(&self, id: &[u8]) -> Option<&'static RuleEntry> {
        let (plugin, name) = parse_rule_id(id);
        self.get(Plugin::from_prefix(plugin)?, name)
    }
}

fn find_deprecated(all: &'static [Deprecated], id: &[u8]) -> Option<&'static Deprecated> {
    let at = all.binary_search_by(|it| it.0.as_bytes().cmp(id));
    all.get(at.ok()?)
}

/// ESLint's deprecation info for the built-in rule `id`, if it's deprecated.
pub fn deprecated_rule(id: &[u8]) -> Option<&'static Deprecated> {
    find_deprecated(deprecated::DEPRECATED, id)
}

/// The deprecated formatting rule that ESLint calls `id`. None of these are implemented because `bun fmt` does their
/// job, but an ESLint config that mentions one is still valid.
pub fn formatting_rule(id: &[u8]) -> Option<&'static Deprecated> {
    find_deprecated(deprecated::FORMATTING, id)
}

/// The JSON that follows `ruleId` in ESLint's `DeprecatedRuleInfo` for `rule`. Only `usedDeprecatedRules` in the JSON
/// output needs it, so release builds embed the text compressed and decompress it here on first use.
pub fn deprecated_info(rule: &Deprecated) -> &'static [u8] {
    static LINES: bun_core::Once<Vec<&'static [u8]>> = bun_core::Once::new();
    let lines = LINES.get_or_init(|| {
        let text = bun_zstd::embed_compressed!(
            "src/lint/linter/deprecated.txt",
            include_bytes!("deprecated.txt")
        );
        strings::split(text, b"\n").collect()
    });
    lines.get(rule.1 as usize).copied().unwrap_or_default()
}

/// The names of all [formatting rules](formatting_rule).
pub fn formatting_rules() -> impl Iterator<Item = &'static str> {
    deprecated::FORMATTING.iter().map(|it| it.0)
}

/// The replacements for a rule ESLint removed, separated by `, `.
pub(crate) fn replacement_of(id: &[u8]) -> Option<&'static str> {
    REPLACEMENTS
        .iter()
        .find(|it| it.0.as_bytes() == id)
        .map(|it| it.1)
}

/// ESLint's `createMissingRuleMessage`.
pub(crate) fn missing_rule_message(id: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(id.len() + 40);
    match REPLACEMENTS.iter().find(|it| it.0.as_bytes() == id) {
        Some((_, replacements)) => {
            out.extend_from_slice(b"Rule '");
            out.extend_from_slice(id);
            out.extend_from_slice(b"' was removed and replaced by: ");
            out.extend_from_slice(replacements.as_bytes());
        }
        None => {
            out.extend_from_slice(b"Definition for rule '");
            out.extend_from_slice(id);
            out.extend_from_slice(b"' was not found.");
        }
    }
    out
}
