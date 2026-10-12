//! The rules that exist, by name.

#[path = "deprecated_data.rs"]
mod deprecated;

use super::config::oxlint_category;
use crate::rule::{Meta, Plugin};
use crate::runner::RuleEntry;
use bun_core::strings;
pub use deprecated::Deprecated;

/// All the rules that can be configured.
pub struct Registry {
    /// Sorted by plugin and name.
    rules: Vec<&'static RuleEntry>,
    native_plugins: NativePlugins,
}

/// For which of the plugins that a configuration of ESLint loads from a package the rules here answer, in place of those of
/// the package.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub enum NativePlugins {
    /// All that are implemented here.
    #[default]
    All,
    None,
    /// By the names that configurations have for them: `react-hooks`, `@typescript-eslint`.
    Only(Vec<Box<[u8]>>),
}

impl NativePlugins {
    /// The names that [`NativePlugins::Only`] can have.
    pub fn names() -> impl Iterator<Item = &'static str> {
        let in_place_of_a_package = Plugin::ALL.iter().filter(|it| it.follows().is_some());
        in_place_of_a_package.map(|it| it.prefix())
    }

    /// `true`, `false`, or names with commas between them. `Err`: a name of no plugin that is implemented here in place of a
    /// package.
    pub fn parse(text: &[u8]) -> Result<NativePlugins, &[u8]> {
        match text {
            b"true" => return Ok(NativePlugins::All),
            b"false" => return Ok(NativePlugins::None),
            _ => {}
        }
        let names = strings::split(text, b",").map(<[u8]>::trim_ascii);
        let names = names.filter(|name| !name.is_empty());
        let names = names.map(|name| match Plugin::answers_in_place_of(name, None) {
            true => Ok(Box::from(name)),
            false => Err(name),
        });
        Ok(NativePlugins::Only(names.collect::<Result<_, _>>()?))
    }
}

/// With which configurations a rule here can be named.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Modes {
    /// Where neither ESLint nor oxlint has a configuration.
    pub native: bool,
    pub eslint: bool,
    pub oxlint: bool,
}

/// [`Registry::names_of`]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Names {
    /// What reports call the rule, but for the formats of oxlint.
    pub id: Vec<u8>,
    /// What else a configuration or a comment can call it where neither ESLint nor oxlint has a configuration.
    pub aliases: Vec<Vec<u8>>,
    pub modes: Modes,
}

/// [`Registry::why_missing`]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Missing {
    /// It is about the layout of the code, which is left to `bun format`.
    Formatting,
    /// It is of a plugin [none of whose rules is here](Plugin::has_no_rules).
    OfPluginWithoutRules(Plugin),
    /// Nobody has such a rule. The name of a rule that is close to it, if one is.
    Unknown(Option<Vec<u8>>),
}

fn written(prefix: &str, name: &str) -> Vec<u8> {
    match prefix {
        "" => name.into(),
        prefix => [prefix, "/", name].concat().into(),
    }
}

/// `conf/replacements.json`: rules that ESLint has removed, and what replaces them.
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

/// oxlint's `TYPESCRIPT_COMPATIBLE_ESLINT_RULES`: the rules of ESLint that understand TypeScript
/// there. It has them in `eslint` only, and `typescript/no-unused-vars` is another name for
/// `no-unused-vars`, whether the plugin is on or not. Sorted.
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

/// Rules that typescript-eslint extends and oxlint has in `typescript` only.
const ONLY_IN_TYPESCRIPT_IN_OXLINT: [&[u8]; 2] = [b"consistent-return", b"dot-notation"];

/// The plugins of oxlint, as it calls them, in the order in which it looks for a rule that is written
/// without its plugin.
const PLUGINS_OF_OXLINT: [(Plugin, &[u8]); 13] = [
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

/// The one name of the built-in plugin of oxlint that `name` is a name of: `LintPlugins::try_from`.
/// What is no name of one is the name of a JavaScript plugin, without `eslint-plugin`.
pub fn plugin_of_oxlint(name: &[u8]) -> &[u8] {
    let name = [&b"/eslint-plugin"[..], b"/oxlint-plugin"]
        .iter()
        .find_map(|it| name.strip_suffix(*it))
        .unwrap_or(name);
    let name = [&b"eslint-plugin-"[..], b"oxlint-plugin-"]
        .iter()
        .find_map(|it| name.strip_prefix(*it))
        .unwrap_or(name);
    match name {
        b"react-hooks" | b"react_hooks" => b"react",
        b"typescript-eslint" | b"typescript_eslint" | b"@typescript-eslint" => b"typescript",
        b"deepscan" => b"oxc",
        b"import-x" => b"import",
        b"jsx_a11y" | b"jsx-a11y-x" | b"jsx_a11y-x" => b"jsx-a11y",
        b"react_perf" => b"react-perf",
        // `unalias_plugin_name`
        b"@next/next" | b"@next" => b"nextjs",
        name => name,
    }
}

/// The rule `name` of `plugin`, which is a name that [`plugin_of_oxlint`] gives, as all of its names
/// are written below.
fn oxlint_key_of(plugin: &[u8], name: &[u8]) -> Vec<u8> {
    match plugin {
        b"eslint" => name.to_vec(),
        plugin => [plugin, b"/", name].concat(),
    }
}

/// Whether oxlint has a rule `name` in `plugin`.
fn is_in_oxlint(plugin: Plugin, name: &[u8]) -> bool {
    std::str::from_utf8(name).is_ok_and(|name| oxlint_category(plugin, name).is_some())
}

/// The one way to write the rule that an `.oxlintrc.json` calls `id`: oxlint's `parse_rule_key` and
/// `transform_rule_and_plugin_name`. All names of a rule are one rule, so what is said last counts:
/// `no-unused-vars`, `eslint/no-unused-vars`, `typescript/no-unused-vars` and
/// `@typescript-eslint/no-unused-vars`; `no-explicit-any` and `typescript/no-explicit-any`;
/// `react-hooks/rules-of-hooks`, `react/rules-of-hooks` and `rules-of-hooks`.
pub fn oxlint_rule_key(id: &[u8]) -> Vec<u8> {
    let (prefix, name) = parse_rule_id(id);
    let plugin = match prefix {
        b"" => (PLUGINS_OF_OXLINT.iter())
            .find(|it| is_in_oxlint(it.0, name))
            .map_or(&b"eslint"[..], |it| it.1),
        prefix => plugin_of_oxlint(prefix),
    };
    match plugin {
        b"typescript" if is_eslint_rule_adapted_to_typescript(name) => name.to_vec(),
        plugin => oxlint_key_of(plugin, name),
    }
}

/// The rules that `-A`, `-W` and `-D` of oxlint mean by `name`, as [`oxlint_rule_key`] writes them.
/// Without a plugin it is every rule of that name. With one it is the rule that oxlint has in that
/// plugin: there `typescript/no-unused-vars` is not a name of `no-unused-vars`, and nothing, as is
/// `eslint/no-explicit-any`.
pub fn oxlint_filter_keys(name: &[u8]) -> Vec<Vec<u8>> {
    let (prefix, rule) = match strings::index_of_char_usize(name, b'/') {
        Some(slash) => (&name[..slash], &name[slash + 1..]),
        None => (&b""[..], name),
    };
    if !prefix.is_empty() {
        let key = oxlint_key_of(plugin_of_oxlint(prefix), rule);
        return match oxlint_rule_key(&key) == key {
            true => vec![key],
            false => Vec::new(),
        };
    }
    let keys: Vec<Vec<u8>> = (PLUGINS_OF_OXLINT.iter())
        .filter(|it| is_in_oxlint(it.0, rule))
        .map(|it| oxlint_key_of(it.1, rule))
        .collect();
    match keys.is_empty() {
        true => vec![rule.to_vec()],
        false => keys,
    }
}

/// The category that oxlint has the rule in that [`oxlint_rule_key`] writes `key`.
pub fn oxlint_category_of_key(key: &[u8]) -> Option<&'static str> {
    let (prefix, name) = parse_rule_id(key);
    oxlint_category(
        Plugin::of_oxlint_prefix(prefix)?,
        std::str::from_utf8(name).ok()?,
    )
}

/// ESLint's `parseRuleId`: the name of the plugin, which is empty for a rule of ESLint itself, and
/// the name of the rule in it.
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
    /// `lists`: `RULES` of each crate that has rules.
    pub fn new(lists: &[&'static [RuleEntry]]) -> Registry {
        let mut rules: Vec<_> = lists.iter().flat_map(|list| list.iter()).collect();
        crate::utils::sort::sort_by_key(&mut rules, |it| (it.meta.plugin as u8, it.meta.name));
        // `usedDeprecatedRules` has what the table says.
        debug_assert!(
            (rules.iter().map(|it| it.meta))
                .filter(|it| it.is_deprecated && !it.follows_oxlint)
                .all(|it| deprecated_rule(&super::RuleId::Known(it).to_vec()).is_some())
        );
        Registry {
            rules,
            native_plugins: NativePlugins::All,
        }
    }

    pub fn answering_for(mut self, which: NativePlugins) -> Registry {
        self.native_plugins = which;
        self
    }

    /// Whether the rules here may answer for the plugin that a configuration of ESLint has as `prefix`, where it has the
    /// package too. The rules of ESLint itself are of no package.
    pub fn answers_for(&self, prefix: &[u8]) -> bool {
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

    /// The rule of which `id` is one more instance, under a name that a configuration gives it: `no-restricted-syntax/<name>`.
    pub fn base_of(&self, id: &[u8]) -> Option<&'static RuleEntry> {
        let (prefix, name) = parse_rule_id(id);
        match prefix == b"no-restricted-syntax" && !name.is_empty() {
            true => self.get(Plugin::Eslint, prefix),
            false => None,
        }
    }

    /// The position of a rule in [`Registry::all`].
    pub fn index_of(&self, entry: &RuleEntry) -> Option<usize> {
        self.index_of_meta(entry.meta)
    }

    pub(super) fn index_of_meta(&self, meta: &Meta) -> Option<usize> {
        let key = (meta.plugin as u8, meta.name);
        self.rules
            .binary_search_by(|it| (it.meta.plugin as u8, it.meta.name).cmp(&key))
            .ok()
    }

    /// The same as [`Registry::get`]. With `prefers_typescript`, which is with a configuration of
    /// oxlint: for a rule of ESLint that typescript-eslint extends and that understands TypeScript in
    /// oxlint, the extension. Without it: not a rule that only oxlint has.
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
            // oxlint has them in one plugin.
            Plugin::React if prefers_typescript => self.get(Plugin::ReactHooks, name),
            _ => None,
        });
        found.filter(|it| prefers_typescript || !it.meta.follows_oxlint)
    }

    /// The same as [`Registry::find`], with what [`Registry::get_preferring`] does.
    pub fn find_preferring(
        &self,
        id: &[u8],
        prefers_typescript: bool,
    ) -> Option<&'static RuleEntry> {
        let (prefix, name) = parse_rule_id(id);
        let plugin = match prefers_typescript {
            true => Plugin::of_oxlint_prefix(prefix),
            false => Plugin::of_prefix(prefix),
        };
        self.get_preferring(plugin?, name, prefers_typescript)
    }

    /// The rule that `id` names where neither ESLint nor oxlint has a configuration: every rule here, by every
    /// [spelling](Plugin::spellings) of its plugin. Of the rule of a plugin for ESLint and oxlint's of the same name, the first.
    pub fn find_by_any_name(&self, id: &[u8]) -> Option<&'static RuleEntry> {
        let (prefix, name) = parse_rule_id(id);
        let found = Plugin::spelled(prefix).filter_map(|it| self.get(it, name));
        found.min_by_key(|it| it.meta.follows_oxlint)
    }

    /// What the rule is called that `meta` is of, or that stands in its place where [any name](Registry::find_by_any_name)
    /// counts.
    pub fn names_of(&self, meta: &Meta) -> Names {
        let own = written(meta.plugin.prefix(), meta.name);
        let meta = self.find_by_any_name(&own).map_or(meta, |it| it.meta);
        let prefixes = meta.plugin.spellings().iter();
        let mut names = prefixes.map(|it| written(it, meta.name));
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

    /// Why [`Registry::find_by_any_name`] finds no `id`.
    pub fn why_missing(&self, id: &[u8]) -> Missing {
        let (prefix, name) = parse_rule_id(id);
        let of_eslint = if prefix == b"eslint" { name } else { id };
        if formatting_rule(of_eslint).is_some() || prefix.starts_with(b"@stylistic") {
            return Missing::Formatting;
        }
        if let Some(plugin) = Plugin::spelled(prefix).find(|it| it.has_no_rules()) {
            return Missing::OfPluginWithoutRules(plugin);
        }
        // The name has to be close. The plugin is as it is written if that is close to a spelling of it. Else, if the name is
        // right or no plugin is written, as reports have it.
        let distance = |a: &[u8], b: &str| strings::edit_distance(a.iter().copied(), b.as_bytes());
        let is_close = |distance: usize, written: &[u8]| distance <= written.len().max(3) / 3;
        let close = self.rules.iter().flat_map(|it| {
            let other = it.meta.name;
            let of_name = Some(distance(name, other)).filter(|it| is_close(*it, name));
            let prefixes = it.meta.plugin.spellings().iter().enumerate();
            prefixes.filter_map(move |(nth, it)| {
                let of_prefix = match prefix {
                    b"" => 0,
                    prefix => distance(prefix, it),
                };
                let is_meant = !prefix.is_empty() && is_close(of_prefix, prefix);
                let is_usual = nth == 0 && (of_name == Some(0) || prefix.is_empty());
                (is_meant || is_usual).then_some((of_name? + of_prefix, written(it, other)))
            })
        });
        Missing::Unknown(close.min_by_key(|it| it.0).map(|it| it.1))
    }

    /// The rule that a configuration or a comment calls `id`: `no-debugger`,
    /// `@typescript-eslint/no-explicit-any`. The names that oxlint has for the same plugins are
    /// understood too: `eslint/no-debugger`, `typescript/no-explicit-any`,
    /// `typescript-eslint/no-explicit-any`, `react/rules-of-hooks`, `node/no-unsupported-features/es-syntax`.
    pub fn find(&self, id: &[u8]) -> Option<&'static RuleEntry> {
        let (plugin, name) = parse_rule_id(id);
        self.get(Plugin::of_prefix(plugin)?, name)
    }
}

fn find_deprecated(all: &'static [Deprecated], id: &[u8]) -> Option<&'static Deprecated> {
    let at = all.binary_search_by(|it| it.0.as_bytes().cmp(id));
    all.get(at.ok()?)
}

/// What ESLint says about the rule here that it calls `id`, if that is deprecated.
pub fn deprecated_rule(id: &[u8]) -> Option<&'static Deprecated> {
    find_deprecated(deprecated::DEPRECATED, id)
}

/// The rule about the layout of the code that ESLint calls `id`, if those who wrote it have deprecated it. None of them is
/// here: `bun format` does their work. A configuration of ESLint that names one is not wrong.
pub fn formatting_rule(id: &[u8]) -> Option<&'static Deprecated> {
    find_deprecated(deprecated::FORMATTING, id)
}

/// The names of all of [these](formatting_rule).
pub fn formatting_rules() -> impl Iterator<Item = &'static str> {
    deprecated::FORMATTING.iter().map(|it| it.0)
}

/// What replaces a rule that ESLint has removed, separated by `, `.
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
