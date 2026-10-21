//! Reads an `.oxlintrc.json` and turns it into flat config objects.
//!
//! - The `correctness` rules warn unless `categories` overrides that.
//! - A rule setting that's only a severity resets the rule's options.
//! - An extended file only contributes its rules, categories, plugins and overrides. All overrides come after all
//!   rules, and their patterns are relative to the extending file.
//! - An ESLint rule that typescript-eslint extends (`no-unused-vars`) understands TypeScript: the extension runs in its
//!   place, and is reported under its own name.

#[path = "oxlint_categories.rs"]
mod categories;

use super::flat::{ConfigError, Reader, Semantics};
use super::ignore_lines::IgnoreLines;
use super::merge::RuleSetting;
use super::{Config, ConfigObject, Pattern, oxlint_options, presets, shape};
use crate::context::Severity;
use crate::fix::SuggestionKind;
use crate::js_plugin;
use crate::linter::registry::{
    Registry, canonical_oxlint_plugin, is_oxlint_rule_key, oxlint_rule_key, parse_rule_id,
};
use crate::linter::resolved::find_js_rule;
use crate::options::Json;
use crate::paths;
use crate::rule::{Meta, Plugin};
use bun_core::strings;
use rustc_hash::{FxBuildHasher, FxHashMap};
use std::borrow::Cow;
use std::hash::BuildHasher;
use std::sync::{Arc, LazyLock};

/// True if `word` is one of the space-separated words in `list`.
fn has_word(list: &str, word: &[u8]) -> bool {
    let list = list.as_bytes();
    let mut from = 0;
    while !word.is_empty()
        && let Some(at) = list.get(from..).and_then(|it| strings::index_of(it, word))
    {
        let (start, end) = (from + at, from + at + word.len());
        if (start == 0 || list[start - 1] == b' ') && list.get(end).is_none_or(|it| *it == b' ') {
            return true;
        }
        from = start + 1;
    }
    false
}

/// How oxlint's `--print-config` writes the rule that [`oxlint_rule_key`] writes as `key`.
fn printed_key(key: &[u8]) -> Vec<u8> {
    let (prefix, name) = parse_rule_id(key);
    let plugin: &[u8] = match prefix {
        b"n" => b"node",
        b"jsx-a11y" => b"jsx_a11y",
        b"react-perf" => b"react_perf",
        _ => return key.to_vec(),
    };
    [plugin, b"/", name].concat()
}

/// The category of each oxlint rule, keyed by its oxlint plugin and its name.
static CATEGORY_OF: LazyLock<FxHashMap<(Plugin, &[u8]), &str>> = LazyLock::new(|| {
    let mut all = FxHashMap::default();
    for (category, lists) in categories::CATEGORIES {
        for (prefix, names) in *lists {
            let Some(plugin) = Plugin::from_oxlint_prefix(prefix.as_bytes()) else {
                continue;
            };
            for name in strings::tokenize(names.as_bytes(), b" ") {
                all.entry((plugin, name)).or_insert(*category);
            }
        }
    }
    all
});

/// The category that oxlint puts the rule in: `correctness`, `suspicious`, `pedantic`, `perf`, `style`, `restriction`,
/// `nursery`.
pub fn oxlint_category(plugin: Plugin, name: &str) -> Option<&'static str> {
    let all: &FxHashMap<(Plugin, &[u8]), &'static str> = &CATEGORY_OF;
    all.get(&(plugin.in_oxlint(), name.as_bytes())).copied()
}

/// True if oxlint doesn't have the rule, so it could only run it as a JavaScript plugin rule. Such a rule is a port of
/// an ESLint rule.
pub fn is_missing_in_oxlint(meta: &Meta) -> bool {
    oxlint_category(meta.plugin, meta.name).is_none()
}

/// True if oxlint runs the rule on TypeScript code (`is_typescript`) or on other code. This is the part of its
/// `should_run` that depends on the language.
pub fn oxlint_runs_on(meta: &Meta, is_typescript: bool) -> bool {
    let lists = match is_typescript {
        true => categories::NOT_TYPESCRIPT,
        false => categories::TYPESCRIPT_ONLY,
    };
    // oxlint lists most of the rules that typescript-eslint extends under their ESLint names.
    let is_of = |plugin: Plugin| {
        plugin == meta.plugin.in_oxlint()
            || (plugin == Plugin::Eslint && meta.extends_base_rule == Some(meta.name))
    };
    !(lists.iter())
        .filter(|it| Plugin::from_oxlint_prefix(it.0.as_bytes()).is_some_and(is_of))
        .any(|it| has_word(it.1, meta.name.as_bytes()))
}

/// Fixes that the generated lists don't describe, or not precisely enough: the plugin, the rule, the report's
/// `messageId` (empty for all of them), and how oxlint 1.87's `--fix` treats the fix. Each was verified by running
/// oxlint.
const PROBED_FIXES: [(Plugin, &str, &str, SuggestionKind); 4] = [
    // `a ? true : false`, `a ? a : b`
    (
        Plugin::Eslint,
        "no-unneeded-ternary",
        "",
        SuggestionKind::DangerousFix,
    ),
    // `if (!!a)`. `if (Boolean(a))` is fixed.
    (
        Plugin::Eslint,
        "no-extra-boolean-cast",
        "unexpectedNegation",
        SuggestionKind::Suggestion,
    ),
    // `a += b` with "never". `a = a + b` with "always" is fixed.
    (
        Plugin::Eslint,
        "operator-assignment",
        "unexpected",
        SuggestionKind::DangerousFix,
    ),
    // `a as string`, by tsgolint 7.0
    (
        Plugin::TypeScript,
        "non-nullable-type-assertion-style",
        "",
        SuggestionKind::Suggestion,
    ),
];

/// Rules for which tsgolint 7.0 has neither a fix nor a suggestion, whatever `oxlint --rules` claims. Each was verified
/// by running it.
const PROBED_WITHOUT_FIX: [(Plugin, &str); 2] = [
    (Plugin::TypeScript, "strict-boolean-expressions"),
    (Plugin::TypeScript, "strict-void-return"),
];

/// The ESLint rules whose suggestions oxlint 1.87 only applies with `--fix-dangerously`. Each was verified by running
/// it.
const DANGEROUS_SUGGESTIONS: [&str; 3] = ["eqeqeq", "radix", "require-await"];

/// How an ESLint rule's fix and suggestions are reclassified with an oxlint config, so that `--fix`,
/// `--fix-suggestions` and `--fix-dangerously` change the same things as in oxlint.
#[derive(Copy, Clone, Default)]
pub(crate) struct OxlintChanges {
    /// oxlint's rule never changes anything, whatever the flags.
    pub(crate) are_dropped: bool,
    /// The fix becomes a suggestion of this kind.
    pub(crate) fix: Option<SuggestionKind>,
    /// The suggestions become this kind.
    pub(crate) suggestions: Option<SuggestionKind>,
}

/// `meta` is the rule that the report is attributed to.
pub(crate) fn oxlint_changes(meta: &Meta, message_id: &str) -> OxlintChanges {
    if meta.follows_oxlint {
        return OxlintChanges::default();
    }
    let is_in = |list: &[(&str, &str)]| {
        (list.iter())
            .filter(|it| Plugin::from_oxlint_prefix(it.0.as_bytes()) == Some(meta.plugin))
            .any(|it| has_word(it.1, meta.name.as_bytes()))
    };
    let probed = (PROBED_FIXES.iter()).find(|it| {
        it.0 == meta.plugin && it.1 == meta.name && (it.2.is_empty() || it.2 == message_id)
    });
    let only_suggests =
        || is_in(categories::ONLY_SUGGESTIONS).then_some(SuggestionKind::Suggestion);
    let is_dangerous = meta.plugin == Plugin::Eslint && DANGEROUS_SUGGESTIONS.contains(&meta.name);
    OxlintChanges {
        are_dropped: probed.is_none()
            && (is_in(categories::WITHOUT_FIX)
                || PROBED_WITHOUT_FIX.contains(&(meta.plugin, meta.name))),
        fix: probed.map(|it| it.3).or_else(only_suggests),
        suggestions: is_dangerous.then_some(SuggestionKind::DangerousFix),
    }
}

/// True if oxlint has a rule named `name` in any plugin.
pub(crate) fn is_oxlint_rule(name: &[u8]) -> bool {
    (categories::CATEGORIES.iter().flat_map(|it| it.1)).any(|it| has_word(it.1, name))
}

/// True if a plugin with no built-in rules has a rule named `name`.
pub(crate) fn is_rule_not_built_in(name: &[u8]) -> bool {
    (categories::NOT_BUILT_IN.iter()).any(|it| has_word(it.2, name))
}

/// The values that oxlint 1.80 accepts in `plugins`, after stripping `eslint-plugin-` or `oxlint-plugin-`. Each was
/// verified by running it.
const PLUGIN_NAMES: [&[u8]; 23] = [
    b"eslint",
    b"react",
    b"react-hooks",
    b"react_hooks",
    b"unicorn",
    b"typescript",
    b"typescript-eslint",
    b"@typescript-eslint",
    b"oxc",
    b"deepscan",
    b"import",
    b"import-x",
    b"jsdoc",
    b"jest",
    b"vitest",
    b"jsx-a11y",
    b"jsx_a11y",
    b"nextjs",
    b"react-perf",
    b"react_perf",
    b"promise",
    b"node",
    b"vue",
];

/// True if oxlint reserves `name` for one of its own plugins. It treats `n` as a package, because its own plugin is
/// `node`.
pub fn is_oxlint_plugin(name: &[u8]) -> bool {
    PLUGIN_NAMES.contains(&name)
}

/// The files that are linted by default. For the last three extensions, only the scripts in them.
const LINTED_FILES: &[u8] = b"**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue,svelte,astro}";

/// A string, or the strings of an array.
pub fn strings_of(json: Option<&Json>) -> Vec<&[u8]> {
    match json {
        Some(Json::String(one)) => vec![&one[..]],
        Some(Json::Array(items)) => items.iter().filter_map(Json::as_str).collect(),
        _ => Vec::new(),
    }
}

/// `"allow"` and `"deny"` are oxlint's names for `"off"` and `"error"`.
fn with_eslint_severities(rules: &Json) -> Json {
    let severity = |value: &Json| match value.as_str() {
        Some(b"allow") => Json::Number(0.0),
        Some(b"deny") => Json::Number(2.0),
        _ => value.clone(),
    };
    let entries = rules
        .as_object()
        .unwrap_or_default()
        .iter()
        .map(|(id, value)| {
            let value = match value {
                Json::Array(items) if !items.is_empty() => {
                    let mut items = items.clone();
                    items[0] = severity(&items[0]);
                    Json::Array(items)
                }
                value => severity(value),
            };
            (id.clone(), value)
        });
    Json::Object(entries.collect())
}

/// True if oxlint has a rule `name` in `plugin`, which is a name returned by [`canonical_oxlint_plugin`]. `key` is the
/// rule as [`oxlint_rule_key`] writes it.
fn is_in_oxlint(plugin: &[u8], name: &[u8], key: &[u8]) -> bool {
    let not_built_in = || categories::NOT_BUILT_IN.iter();
    is_oxlint_rule_key(key)
        || not_built_in().any(|it| it.0.as_bytes() == plugin && has_word(it.2, name))
}

/// Loads a JavaScript plugin: [`Host::load`](crate::js_plugin::Host::load). It gets the directory of the file that
/// lists the plugin, the specifier, and the name that the file gives the plugin, if any.
pub type LoadPlugin<'l> =
    dyn FnMut(&[u8], &[u8], Option<&[u8]>) -> Result<Arc<js_plugin::Plugin>, Vec<u8>> + 'l;

struct Rc<'r, 'l> {
    reader: Reader<'r>,
    /// Reads a file listed in `extends`, relative to the directory in the first argument.
    load: &'l mut dyn FnMut(&[u8], &[u8]) -> Option<Json>,
    /// `None` means JavaScript plugins are skipped.
    load_plugin: Option<&'l mut LoadPlugin<'l>>,
    /// `categories`. Later entries override earlier ones.
    categories: Vec<(Vec<u8>, Severity)>,
    /// The same without the effect of `-A`, `-W` and `-D`: `$categoriesOfTheFile`, where a file has it.
    file_categories: Vec<(Vec<u8>, Severity)>,
    /// The `plugins` of all files and overrides. A file without `plugins` counts as typescript, unicorn and oxc.
    plugins: Vec<Vec<u8>>,
    /// In oxlint, all files' overrides come after all files' rules. Each is stored with its `plugins`.
    overrides: Vec<(ConfigObject, Option<Vec<Vec<u8>>>)>,
    /// [`Config::oxlintrc_option`]
    options: Vec<(Vec<u8>, Json)>,
    /// The `plugins` of all files, without those of overrides.
    file_plugins: Vec<Vec<u8>>,
    /// Each override's `rules` as written, and its `plugins`.
    override_rules: Vec<(Vec<(Vec<u8>, Json)>, Vec<Vec<u8>>)>,
    /// The `plugins` of the files that have the key.
    named_plugins: Option<Vec<Vec<u8>>>,
}

/// A rule as a file writes it.
struct WrittenRule {
    /// oxlint's `parse_rule_key`
    plugin: Vec<u8>,
    name: Vec<u8>,
    id: Vec<u8>,
    setting: Json,
    /// [`merged`] dropped another entry with the same name in favor of this one.
    replaced_duplicate: bool,
}

/// The `rules` of `json`.
fn written_rules(json: &Json) -> Vec<WrittenRule> {
    let rules = json.get(b"rules").and_then(Json::as_object);
    let to_written_rule = |(id, setting): &(Vec<u8>, Json)| {
        let ((prefix, name), key) = (parse_rule_id(id), oxlint_rule_key(id));
        let plugin = match (prefix, parse_rule_id(&key).0) {
            (b"", b"") => Cow::Borrowed(&b"eslint"[..]),
            (b"", key_prefix) => Cow::Borrowed(key_prefix),
            (prefix, _) => canonical_oxlint_plugin(prefix),
        };
        let plugin = match &*plugin {
            b"jsx-a11y" => &b"jsx_a11y"[..],
            b"react-perf" => b"react_perf",
            plugin => plugin,
        };
        WrittenRule {
            plugin: plugin.to_vec(),
            name: name.to_vec(),
            id: id.clone(),
            setting: setting.clone(),
            replaced_duplicate: false,
        }
    };
    rules
        .unwrap_or_default()
        .iter()
        .map(to_written_rule)
        .collect()
}

/// oxlint's `Oxlintrc::merge` for rules. The rules of `extended` that `own` doesn't list are added, and the result is
/// in the order of oxlint's hash table, as it is on x86-64.
fn merged(own: Vec<WrittenRule>, extended: Vec<WrittenRule>) -> Vec<WrittenRule> {
    fn text(it: &[u8]) -> &str {
        std::str::from_utf8(it).unwrap_or_default()
    }
    let mut all: Vec<Option<WrittenRule>> = own.into_iter().chain(extended).map(Some).collect();
    // The first entry for each name, in insertion order, and the names' hashes.
    let mut firsts: Vec<(usize, bool)> = Vec::new();
    let mut hashes: Vec<u32> = Vec::new();
    let mut first_index_by_name: FxHashMap<(&str, &str), usize> = FxHashMap::default();
    for (at, it) in all.iter().flatten().enumerate() {
        let name = (text(&it.plugin), text(&it.name));
        match first_index_by_name
            .get(&name)
            .and_then(|first_index| firsts.get_mut(*first_index))
        {
            Some(first) => first.1 = true,
            None => {
                first_index_by_name.insert(name, firsts.len());
                hashes.push(FxBuildHasher.hash_one(name) as u32);
                firsts.push((at, it.replaced_duplicate));
            }
        }
    }
    let order = crate::semantic::hashbrown_table_order(&hashes, 0);
    let order: Vec<(usize, bool)> = (order.iter())
        .filter_map(|first_index| firsts.get(*first_index as usize).copied())
        .collect();
    let in_order = order.iter().filter_map(|&(at, replaced_duplicate)| {
        let it = all.get_mut(at)?.take()?;
        Some(WrittenRule {
            replaced_duplicate,
            ..it
        })
    });
    in_order.collect()
}

/// True if `plugin` is one of `names`, which are written as in an oxlint config file.
fn is_among(plugin: Plugin, names: &[Vec<u8>]) -> bool {
    (names.iter()).any(|it| {
        Plugin::from_oxlint_prefix(&canonical_oxlint_plugin(it)) == Some(plugin.in_oxlint())
    })
}

/// `names`, which are written as in an oxlint config file, as a bit set. `eslint` isn't a plugin.
fn plugin_bits(names: &[Vec<u8>]) -> u32 {
    let plugins =
        (names.iter()).filter_map(|it| Plugin::from_oxlint_prefix(&canonical_oxlint_plugin(it)));
    let plugins = plugins.filter(|it| *it != Plugin::Eslint);
    plugins.fold(0, |set, it| set | (1 << (it.in_oxlint() as u32)))
}

/// oxlint's plugins, in the order it prints them.
const PRINTED_PLUGINS: [&[u8]; 14] = [
    b"react",
    b"unicorn",
    b"typescript",
    b"oxc",
    b"import",
    b"jsdoc",
    b"jest",
    b"vitest",
    b"jsx-a11y",
    b"nextjs",
    b"react-perf",
    b"promise",
    b"node",
    b"vue",
];

/// oxlint's categories, in the order it prints them.
const PRINTED_CATEGORIES: [&[u8]; 7] = [
    b"correctness",
    b"suspicious",
    b"pedantic",
    b"perf",
    b"style",
    b"restriction",
    b"nursery",
];

/// `settings` as oxlint prints them when there's no config file.
const PRINTED_SETTINGS: &[u8] = br#"{
  "jsx-a11y": { "polymorphicPropName": null, "components": {}, "attributes": {} },
  "next": { "rootDir": [] },
  "react": { "formComponents": [], "linkComponents": [], "version": null, "componentWrapperFunctions": [] },
  "jsdoc": {
    "ignorePrivate": false,
    "ignoreInternal": false,
    "ignoreReplacesDocs": true,
    "overrideReplacesDocs": true,
    "augmentsExtendsReplacesDocs": false,
    "implementsReplacesDocs": false,
    "exemptDestructuredRootsFromChecks": false,
    "tagNamePreference": {}
  },
  "vitest": { "typecheck": false },
  "jest": { "version": null }
}"#;

/// `"deny"`, or `["deny", [..]]`.
fn printed_setting(severity: Severity, options: &[Json]) -> Json {
    let severity: &[u8] = match severity {
        Severity::Off => b"allow",
        Severity::Warn => b"warn",
        Severity::Error => b"deny",
    };
    let severity = Json::String(severity.to_vec());
    match options {
        [] => severity,
        options => Json::Array(vec![severity, Json::Array(options.to_vec())]),
    }
}

/// The `rules` of `json` as oxlint prints them in an override, which is as written.
fn printed_rules(json: &Json) -> Json {
    let rules = json.get(b"rules").and_then(Json::as_object);
    let printed = rules.unwrap_or_default().iter().filter_map(|(id, value)| {
        let setting = RuleSetting::new(id, value)?;
        Some((
            id.clone(),
            printed_setting(setting.severity, &setting.options),
        ))
    });
    Json::Object(printed.collect())
}

/// The `globals` of `json`, with each value normalized to the one name oxlint prints.
fn printed_globals(json: &Json) -> Option<Json> {
    let globals = json.get(b"globals")?.as_object()?.iter();
    let printed = globals.map(|(name, value)| {
        let value: &[u8] = match value {
            Json::Bool(true) => b"writable",
            Json::String(it) if matches!(&it[..], b"writable" | b"writeable") => b"writable",
            Json::String(it) if &it[..] == b"off" => b"off",
            _ => b"readonly",
        };
        (name.clone(), Json::String(value.to_vec()))
    });
    Some(Json::Object(printed.collect()))
}

/// An override's patterns at `key`, as `GlobSet` stores them.
fn printed_patterns(json: &Json, key: &[u8]) -> Option<Json> {
    let patterns = strings_of(Some(json.get(key)?)).into_iter();
    let printed = patterns.map(|it| match it.strip_prefix(b"./") {
        Some(rest) => rest.to_vec(),
        None if strings::contains_char(it, b'/') => it.to_vec(),
        None => [b"**/", it].concat(),
    });
    Some(Json::Array(printed.map(Json::String).collect()))
}

impl Rc<'_, '_> {
    /// Builds `languageOptions` from `env`, `globals`, `parser` and `parserOptions`.
    fn language_options(&self, json: &Json) -> Json {
        let mut entries = Vec::new();
        for (from, to) in [
            (&b"env"[..], &b"$env"[..]),
            (b"globals", b"globals"),
            (b"parser", b"parser"),
            (b"parserOptions", b"parserOptions"),
        ] {
            if let Some(value) = json.get(from).filter(|it| **it != Json::Null) {
                entries.push((to.to_vec(), value.clone()));
            }
        }
        // In an `.eslintrc` these two are parser options.
        for key in [&b"ecmaVersion"[..], b"sourceType"] {
            if let Some(value) = json.get(b"parserOptions").and_then(|it| it.get(key)) {
                entries.push((key.to_vec(), value.clone()));
            }
        }
        if entries.is_empty() {
            Json::Null
        } else {
            Json::Object(entries)
        }
    }

    /// Rejects the options in `rules` (as written) that an oxlint rule doesn't accept. oxlint reports all the errors
    /// together, sorted by text, even for a rule that's off.
    ///
    /// `plugins` are the plugins that are on here. oxlint doesn't check the options of another plugin's rule, going by
    /// the name as written: with `"plugins": []` it skips `@typescript-eslint/no-unused-vars` but checks
    /// `no-unused-vars`.
    fn reject_invalid_options(
        &self,
        rules: &[(&[u8], &Json)],
        plugins: &[Vec<u8>],
    ) -> Result<(), ConfigError> {
        let js_plugins = &self.reader.js_plugins;
        let mut refusals: Vec<Vec<u8>> = Vec::new();
        for &(id, setting) in rules {
            if find_js_rule(js_plugins, id).is_some() {
                continue;
            }
            let (key, (written_prefix, name)) = (oxlint_rule_key(id), parse_rule_id(id));
            let plugin = match (written_prefix, parse_rule_id(&key).0) {
                (b"", b"") => Cow::Borrowed(&b"eslint"[..]),
                (b"", key_prefix) => Cow::Borrowed(key_prefix),
                (written_prefix, _) => canonical_oxlint_plugin(written_prefix),
            };
            let is_on = *plugin == *b"eslint"
                || plugins
                    .iter()
                    .any(|it| canonical_oxlint_plugin(it) == plugin);
            let options = setting.as_array().and_then(|it| it.get(1..));
            if is_on
                && is_in_oxlint(&plugin, name, &key)
                && let Some(why) = oxlint_options::options_error(&key, options.unwrap_or_default())
            {
                let start: &[u8] = b"Invalid configuration for rule `";
                let name = parse_rule_id(&key).1;
                refusals.push(match &*plugin {
                    b"eslint" => [start, name, b"`:\n", &why].concat(),
                    b"jsx-a11y" => [start, b"jsx_a11y/", name, b"`:\n", &why].concat(),
                    b"react-perf" => [start, b"react_perf/", name, b"`:\n", &why].concat(),
                    plugin => [start, plugin, b"/", name, b"`:\n", &why].concat(),
                });
            }
        }
        if refusals.is_empty() {
            return Ok(());
        }
        crate::utils::sort::sort(&mut refusals);
        refusals.dedup();
        Err(ConfigError {
            message: refusals.join(&b"\n\n"[..]),
        })
    }

    fn rules(&mut self, json: &Json) -> Result<Vec<RuleSetting>, ConfigError> {
        let Some(rules) = json.get(b"rules") else {
            return Ok(Vec::new());
        };
        let mut rules = with_eslint_severities(rules);
        // All of a rule's names refer to one rule, so the file's last entry for it wins.
        if let Json::Object(entries) = &mut rules {
            for (id, _) in entries {
                if find_js_rule(&self.reader.js_plugins, id).is_none() {
                    *id = oxlint_rule_key(id);
                }
            }
        }
        self.reader.rules(&rules)
    }

    /// `no-shadow` and `@typescript-eslint/no-shadow` are two entries in [`merged`]'s table but one rule when they're
    /// applied, in the order of `rules`. The later one wins.
    fn apply_later_aliases(&mut self, rules: &[WrittenRule]) -> Result<(), ConfigError> {
        let mut last: FxHashMap<Vec<u8>, (usize, usize)> = FxHashMap::default();
        for (at, it) in rules.iter().enumerate() {
            let known = last.entry(oxlint_rule_key(&it.id)).or_default();
            *known = (at, known.1 + 1 + usize::from(it.replaced_duplicate));
        }
        let later = last.into_values().filter(|it| it.1 > 1);
        let later = crate::utils::sort::collect_sorted_by_key(later, |it| it.0);
        let later = later.iter().filter_map(|it| rules.get(it.0));
        let later: Vec<_> = later
            .map(|it| (it.id.clone(), it.setting.clone()))
            .collect();
        if !later.is_empty() {
            let json = Json::Object(vec![(b"rules".to_vec(), Json::Object(later))]);
            let rules = self.rules(&json)?;
            self.reader.objects.push(ConfigObject {
                rules,
                ..ConfigObject::default()
            });
        }
        Ok(())
    }

    /// Loads the plugins listed in the `jsPlugins` of `json`, which is a file in `directory` or one of its overrides.
    fn load_js_plugins(&mut self, json: &Json, directory: &[u8]) -> Result<(), ConfigError> {
        for plugin in json
            .get(b"jsPlugins")
            .and_then(Json::as_array)
            .unwrap_or_default()
        {
            let specifier = plugin
                .as_str()
                .or_else(|| plugin.get(b"specifier").and_then(Json::as_str))
                .unwrap_or(b"?");
            let Some(load) = &mut self.load_plugin else {
                self.reader.note(&[
                    b"\"jsPlugins\" is not supported here, so the rules of \"",
                    specifier,
                    b"\" were skipped",
                ]);
                continue;
            };
            let alias = plugin.get(b"name").and_then(Json::as_str);
            let loaded = load(directory, specifier, alias).map_err(|why| {
                ConfigError::new(&[b"Failed to load JS plugin: ", specifier, b"\n  ", &why])
            })?;
            let name = &loaded.name[..];
            if PLUGIN_NAMES.contains(&name) {
                return Err(ConfigError::new(&[
                    b"Plugin name '",
                    name,
                    b"' is reserved, and cannot be used for JS plugins.\n\nThe '",
                    name,
                    b"' plugin is built in. To use an external '",
                    name,
                    b"' plugin instead, provide a custom alias:\n\n\"jsPlugins\": [{ \"name\": \"",
                    name,
                    b"-js\", \"specifier\": \"eslint-plugin-",
                    name,
                    b"\" }]\n\nThen reference rules using your alias:\n\n\"rules\": {\n  \"",
                    name,
                    b"-js/rule-name\": \"error\"\n}",
                ]));
            }
            let all = &mut self.reader.js_plugins;
            if !all.iter().any(|it| it.name == loaded.name) {
                all.push(loaded);
            }
        }
        Ok(())
    }

    /// Adds the objects for the file `json`, which is in `directory`. `is_extended` means another file extends it.
    /// Returns its rules merged with those of the files it extends, as oxlint stores them.
    fn file(
        &mut self,
        json: &Json,
        directory: &[u8],
        is_extended: bool,
    ) -> Result<Vec<WrittenRule>, ConfigError> {
        if json.as_object().is_none() {
            return Err(ConfigError::new(&[b"Unexpected non-object config."]));
        }
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            return Err(ConfigError::new(&[b"Too many levels of \"extends\"."]));
        }
        if is_extended {
            shape::check(json)?;
        }
        // A plugin that an override lists is available everywhere.
        self.load_js_plugins(json, directory)?;
        for item in json
            .get(b"overrides")
            .and_then(Json::as_array)
            .unwrap_or_default()
        {
            self.load_js_plugins(item, directory)?;
        }
        let extends = match json.get(b"extends") {
            Some(Json::Array(items)) => &items[..],
            Some(one) => std::slice::from_ref(one),
            None => &[],
        };
        let mut extended_rules = Vec::new();
        for extended in extends {
            // An object that an `oxlint.config.ts` imported.
            if extended.as_object().is_some() {
                extended_rules.push(self.file(extended, directory, true)?);
                continue;
            }
            let Some(name) = extended.as_str() else {
                continue;
            };
            if name.starts_with(b"eslint:") {
                return Err(ConfigError::new(&[
                    b"Unsupported named config \"",
                    name,
                    b"\" in extends. Oxlint does not support ESLint shared configs. If this is a file path, add a file extension (e.g., \".json\").",
                ]));
            }
            if let Some(objects) = presets::find(name) {
                for object in &objects {
                    let object = self.reader.object(object)?;
                    self.reader.objects.push(object);
                }
                continue;
            }
            let portable = paths::portable(directory, name);
            let Some(extended) = (self.load)(directory, &portable) else {
                return Err(ConfigError::new(&[
                    b"Failed to load config \"",
                    name,
                    b"\" to extend from.",
                ]));
            };
            let file = paths::resolve(directory, &portable);
            let read = self.file(&extended, paths::dirname(&file), true);
            extended_rules.push(read.map_err(|error| {
                ConfigError::new(&[
                    b"invalid config file ",
                    directory,
                    b"/",
                    name,
                    b": ",
                    &error.message,
                ])
            })?);
        }
        let categories = json.get(b"categories");
        let own_categories = json.get(b"$categoriesOfTheFile").or(categories);
        for (category_json, all) in [
            (categories, &mut self.categories),
            (own_categories, &mut self.file_categories),
        ] {
            for (category, severity) in category_json.and_then(Json::as_object).unwrap_or_default()
            {
                let severity = match severity.as_str() {
                    Some(b"allow") => Some(Severity::Off),
                    Some(b"deny") => Some(Severity::Error),
                    _ => crate::linter::severity_of(severity),
                };
                let Some(severity) = severity else {
                    return Err(ConfigError::new(&[
                        b"Key \"categories\": Key \"",
                        category,
                        b"\": Expected severity.",
                    ]));
                };
                all.retain(|it| it.0 != *category);
                all.push((category.clone(), severity));
            }
        }
        let named = self.plugin_names(json)?;
        if let Some(named) = &named {
            (self.named_plugins.get_or_insert_default()).extend_from_slice(named);
        }
        let plugins = named.unwrap_or_else(|| {
            [&b"typescript"[..], b"unicorn", b"oxc"]
                .map(<[u8]>::to_vec)
                .into()
        });
        self.file_plugins.extend_from_slice(&plugins);
        self.plugins.extend_from_slice(&plugins);
        // All patterns are relative to the extending file.
        let is_root_file = !is_extended;

        let ignore_patterns = strings_of(json.get(b"ignorePatterns"));
        if !ignore_patterns.is_empty() && is_root_file {
            self.reader.objects.push(ConfigObject {
                ignore_lines: Some(IgnoreLines::of_oxlint(&ignore_patterns)),
                is_global_ignores: true,
                ignores_inside_only: true,
                ..ConfigObject::default()
            });
        }
        for (name, value) in (json.get(b"options").and_then(Json::as_object)).unwrap_or_default() {
            self.options.retain(|it| it.0 != *name);
            self.options.push((name.clone(), value.clone()));
        }
        let mut linter_options = Vec::new();
        for key in [&b"noInlineConfig"[..], b"reportUnusedDisableDirectives"] {
            let value = json
                .get(key)
                .or_else(|| json.get(b"options").and_then(|it| it.get(key)));
            if let Some(value) = value {
                let value = if value.as_str() == Some(b"deny") {
                    Json::Number(2.0)
                } else {
                    value.clone()
                };
                linter_options.push((key.to_vec(), value));
            }
        }
        let mut base = ConfigObject {
            rules: self.rules(json)?,
            ..ConfigObject::default()
        };
        if is_root_file {
            base.language_options = self.language_options(json);
            // oxlint's default, which an `env` replaces and an override adds to. An extended file's `env` doesn't
            // count.
            if json.get(b"env").is_none_or(|it| *it == Json::Null) {
                let builtin = Json::Object(vec![(b"builtin".to_vec(), Json::Bool(true))]);
                if !matches!(base.language_options, Json::Object(_)) {
                    base.language_options = Json::Object(Vec::new());
                }
                if let Json::Object(entries) = &mut base.language_options {
                    entries.push((b"$env".to_vec(), builtin));
                }
            }
            base.settings = json
                .get(b"settings")
                .cloned()
                .and_then(ConfigObject::settings_of);
            base.linter_options = Json::Object(linter_options);
        }
        self.reader.objects.push(base);
        // oxlint merges from last to first.
        let is_merged = !extended_rules.is_empty();
        let extended = extended_rules.into_iter().rev();
        let rules = extended.fold(written_rules(json), merged);
        // All files' plugins are on, or oxlint's defaults if no file lists any.
        let on = self.named_plugins.clone().unwrap_or(plugins);
        if !is_extended {
            let rule_entries: Vec<_> = (rules.iter().map(|it| (&it.id[..], &it.setting))).collect();
            self.reject_invalid_options(&rule_entries, &on)?;
        }
        if is_merged && !is_extended {
            self.apply_later_aliases(&rules)?;
        }

        for item in json
            .get(b"overrides")
            .and_then(Json::as_array)
            .unwrap_or_default()
        {
            let item = shape::override_with_keys(item);
            let item = &*item;
            let files = strings_of(item.get(b"files"));
            let excluded = strings_of(item.get(b"excludeFiles"));
            let plugins = self.plugin_names(item)?;
            (self.plugins).extend_from_slice(plugins.as_deref().unwrap_or_default());
            self.override_rules.push((
                (item.get(b"rules").and_then(Json::as_object))
                    .unwrap_or_default()
                    .to_vec(),
                plugins.clone().unwrap_or_default(),
            ));
            // Overrides from bunfig.toml are marked with `$globsOfBun`. `$basePath` is bunfig.toml's directory.
            let base_path = item.get(b"$basePath").and_then(Json::as_str);
            let pattern = match item.get(b"$globsOfBun") {
                Some(_) => Pattern::of_bunfig,
                None => Pattern::of_oxlint,
            };
            let object = ConfigObject {
                base_path: base_path.map(<[u8]>::to_vec),
                files: Some(files.iter().map(|it| vec![pattern(it)]).collect()),
                ignores: (!excluded.is_empty())
                    .then(|| excluded.iter().map(|it| pattern(it)).collect()),
                language_options: self.language_options(item),
                settings: (item.get(b"settings").cloned()).and_then(ConfigObject::settings_of),
                rules: self.rules(item)?,
                ..ConfigObject::default()
            };
            self.overrides.push((object, plugins));
        }
        // One override at a time, starting with those of the extended files.
        if !is_extended {
            for (override_entries, plugins) in &self.override_rules {
                let rule_entries: Vec<_> = override_entries
                    .iter()
                    .map(|it| (&it.0[..], &it.1))
                    .collect();
                self.reject_invalid_options(&rule_entries, &[&on[..], plugins].concat())?;
            }
        }
        Ok(rules)
    }

    /// The `plugins` of `json`. oxlint rejects a name it doesn't know.
    fn plugin_names(&self, json: &Json) -> Result<Option<Vec<Vec<u8>>>, ConfigError> {
        let Some(plugins) = json.get(b"plugins").and_then(Json::as_array) else {
            return Ok(None);
        };
        let mut names = Vec::with_capacity(plugins.len());
        for plugin_entry in plugins.iter().filter_map(Json::as_str) {
            let name = (plugin_entry.strip_prefix(b"eslint-plugin-"))
                .or_else(|| plugin_entry.strip_prefix(b"oxlint-plugin-"))
                .unwrap_or(plugin_entry);
            if !PLUGIN_NAMES.contains(&name) {
                return Err(ConfigError::new(&[
                    b"Failed to parse config with error Error(\"Unknown plugin: '",
                    plugin_entry,
                    b"'.\", line: 0, column: 0)",
                ]));
            }
            names.push(name.to_vec());
        }
        Ok(Some(names))
    }

    /// True if `plugin`'s rules run wherever no override changes that.
    fn has_plugin(&self, plugin: Plugin) -> bool {
        plugin.is_always_available() || is_among(plugin, &self.file_plugins)
    }

    /// Adds a setting for each built-in rule in `lists`, which holds oxlint's plugin names, each with its rule names.
    /// `of` filters the plugins.
    fn add_settings(
        &self,
        lists: &[(&str, &str)],
        severity: Severity,
        of: &dyn Fn(Plugin) -> bool,
        settings: &mut Vec<RuleSetting>,
    ) {
        for (plugin, names) in lists {
            let Some(plugin) = Plugin::from_oxlint_prefix(plugin.as_bytes()).filter(|it| of(*it))
            else {
                continue;
            };
            for name in strings::split(names.as_bytes(), b" ").filter(|it| !it.is_empty()) {
                let Some(entry) = self.reader.registry.get_preferring(plugin, name, true) else {
                    continue;
                };
                settings.push(RuleSetting {
                    id: crate::linter::RuleId::Known(entry.meta).to_vec().into(),
                    plugin: Box::default(),
                    builtin_plugin: Some(plugin),
                    severity,
                    options: Vec::new(),
                    has_only_severity: true,
                    yields: false,
                    defaults: Vec::new(),
                });
            }
        }
    }

    /// The rules that `categories` turns on, which everything else overrides. `of` filters the plugins.
    fn category_rules(
        &self,
        categories: &[(Vec<u8>, Severity)],
        of: &dyn Fn(Plugin) -> bool,
    ) -> Vec<RuleSetting> {
        let mut settings = Vec::new();
        for (category, severity) in categories {
            if let Some((_, lists)) = categories::CATEGORIES
                .iter()
                .find(|it| it.0.as_bytes() == &category[..])
            {
                self.add_settings(lists, *severity, of, &mut settings);
            }
        }
        settings
    }

    /// The plugins [with no built-in rules](Plugin::has_no_rules) for which `categories` turns rules on. `of` filters
    /// the plugins.
    fn without_rules(
        &self,
        categories: &[(Vec<u8>, Severity)],
        of: &dyn Fn(Plugin) -> bool,
    ) -> Vec<Plugin> {
        let on = || categories.iter().filter(|it| it.1 != Severity::Off);
        let lists = categories::NOT_BUILT_IN.iter();
        let lists = lists.filter(|it| on().any(|category| has_word(it.1, &category.0)));
        let plugins = lists.filter_map(|it| Plugin::from_oxlint_prefix(it.0.as_bytes()));
        plugins.filter(|it| of(*it)).collect()
    }

    /// The overrides, as oxlint 1.87 applies them. An override's `plugins` only apply to that override. Its `rules` can
    /// list those plugins' rules, which the `rules` of the files and of other overrides can't. Where it applies,
    /// `categories` turns on its plugins' rules, unless an earlier override already has. The command line's category
    /// flags don't count for that, but see [`ConfigObject::override_plugin_sets`].
    fn take_overrides(&mut self) -> Vec<ConfigObject> {
        let overrides = std::mem::take(&mut self.overrides);
        let file_plugin_bits = plugin_bits(&self.file_plugins);
        let objects = overrides.into_iter().map(|(mut object, plugins)| {
            object.override_plugin_sets = plugins
                .as_deref()
                .map(|it| (plugin_bits(it), file_plugin_bits));
            let plugins = plugins.unwrap_or_default();
            let is_own = |it: Plugin| !self.has_plugin(it) && is_among(it, &plugins);
            (object.rules).retain(|it| {
                (it.builtin_plugin).is_none_or(|it| self.has_plugin(it) || is_own(it))
            });
            if !plugins.is_empty() {
                let mut rules = self.category_rules(&self.file_categories, &is_own);
                rules.iter_mut().for_each(|it| it.yields = true);
                rules.append(&mut object.rules);
                object.rules = rules;
                object.without_rules = self.without_rules(&self.file_categories, &is_own);
            }
            object
        });
        objects.collect()
    }

    /// The rules that `categories` turns on for the enabled plugins, that aren't built in, and that no file mentions.
    /// They're written as [`oxlint_rule_key`] writes them.
    fn missing_category_rules(&self) -> Vec<Vec<u8>> {
        let is_named = |key: &[u8]| {
            let objects = self.reader.objects.iter();
            let objects = objects.chain(self.overrides.iter().map(|it| &it.0));
            objects.flat_map(|it| &it.rules).any(|it| *it.id == *key)
        };
        let mut lacking = Vec::new();
        for (category, _) in (self.categories.iter()).filter(|it| it.1 != Severity::Off) {
            let lists = categories::CATEGORIES.iter();
            let lists = lists.filter(|it| it.0.as_bytes() == &category[..]);
            for (plugin, names) in lists.flat_map(|it| it.1) {
                let plugin = plugin.as_bytes();
                let is_on = |it: &Vec<u8>| canonical_oxlint_plugin(it) == plugin;
                if plugin != b"eslint" && !self.plugins.iter().any(is_on) {
                    continue;
                }
                let exists = |name: &[u8]| {
                    Plugin::from_oxlint_prefix(plugin).is_some_and(|it| {
                        self.reader
                            .registry
                            .get_preferring(it, name, true)
                            .is_some()
                    })
                };
                let names = strings::split(names.as_bytes(), b" ").filter(|it| !it.is_empty());
                let keys = names
                    .filter(|name| !exists(name))
                    .map(|name| oxlint_rule_key(&[plugin, b"/", name].concat()));
                lacking.extend(keys.filter(|key| !is_named(key)));
            }
        }
        lacking
    }

    /// Returns what oxlint's `--print-config` prints for the file `json`: its contents, plus the plugins of the files
    /// it extends and the rules that are on where no override applies. `categories_at` is the index of the object with
    /// the categories' rules.
    fn printed(&self, json: &Json, categories_at: usize) -> Vec<(Vec<u8>, Json)> {
        let mut rules: Vec<(Vec<u8>, &RuleSetting)> = Vec::new();
        let mut rule_index_by_key: FxHashMap<Vec<u8>, usize> = FxHashMap::default();
        for (at, object) in self.reader.objects.iter().enumerate() {
            let is_told = |it: &&RuleSetting| {
                (at != categories_at || it.severity != Severity::Off)
                    && it.builtin_plugin.is_none_or(|it| self.has_plugin(it))
            };
            let is_native = |it: &&RuleSetting| {
                it.builtin_plugin.is_some()
                    || find_js_rule(&self.reader.js_plugins, &it.id).is_none()
            };
            for setting in object.rules.iter().filter(is_told).filter(is_native) {
                let key = oxlint_rule_key(&setting.id);
                match rule_index_by_key.get(&key) {
                    Some(&rule_index) => rules[rule_index].1 = setting,
                    None => {
                        rule_index_by_key.insert(key.clone(), rules.len());
                        rules.push((printed_key(&key), setting));
                    }
                }
            }
        }
        // ESLint's rules come first.
        crate::utils::sort::sort_by(&mut rules, |a, b| {
            parse_rule_id(&a.0).cmp(&parse_rule_id(&b.0))
        });
        let rules =
            (rules.into_iter()).map(|(key, it)| (key, printed_setting(it.severity, &it.options)));
        let is_on = |name: &&&[u8]| {
            (self.file_plugins.iter()).any(|it| canonical_oxlint_plugin(it) == **name)
        };
        let plugins = PRINTED_PLUGINS.iter().filter(is_on);
        let plugins = plugins.map(|it| Json::String(it.to_vec()));
        let file_category_json = json.get(b"categories").and_then(Json::as_object);
        let categories = PRINTED_CATEGORIES.iter().filter_map(|name| {
            file_category_json?.iter().find(|it| it.0 == **name)?;
            let severity = self.categories.iter().find(|it| it.0 == **name)?.1;
            Some((name.to_vec(), printed_setting(severity, &[])))
        });
        let mut settings = crate::json::parse(PRINTED_SETTINGS).unwrap_or(Json::Null);
        if let Json::Object(known) = &mut settings {
            for (plugin, defaults) in known {
                let own = json.get(b"settings").and_then(|it| it.get(plugin));
                let (Json::Object(defaults), Some(own)) = (defaults, own) else {
                    continue;
                };
                for (key, value) in defaults {
                    if let Some(own) = own.get(key) {
                        *value = own.clone();
                    }
                }
            }
        }
        let overrides = json.get(b"overrides").and_then(Json::as_array);
        let overrides = overrides.unwrap_or_default().iter().map(|item| {
            let or_null = |it: Option<Json>| it.unwrap_or(Json::Null);
            let entries = [
                (&b"files"[..], printed_patterns(item, b"files")),
                (
                    &b"excludeFiles"[..],
                    printed_patterns(item, b"excludeFiles"),
                ),
                (&b"env"[..], Some(or_null(item.get(b"env").cloned()))),
                (&b"globals"[..], Some(or_null(printed_globals(item)))),
                (
                    &b"plugins"[..],
                    Some(or_null(item.get(b"plugins").cloned())),
                ),
                (&b"jsPlugins"[..], item.get(b"jsPlugins").cloned()),
                (&b"rules"[..], Some(printed_rules(item))),
            ];
            let entries = entries.into_iter();
            Json::Object(
                entries
                    .filter_map(|(key, it)| Some((key.to_vec(), it?)))
                    .collect(),
            )
        });
        let overrides: Vec<Json> = overrides.collect();
        let builtin = Json::Object(vec![(b"builtin".to_vec(), Json::Bool(true))]);
        let empty = || Json::Object(Vec::new());
        let has_overrides = !overrides.is_empty();
        let ignored = json.get(b"ignorePatterns").cloned();
        let entries = [
            (&b"$schema"[..], json.get(b"$schema").cloned()),
            (&b"plugins"[..], Some(Json::Array(plugins.collect()))),
            (&b"jsPlugins"[..], json.get(b"jsPlugins").cloned()),
            (&b"categories"[..], Some(Json::Object(categories.collect()))),
            (&b"rules"[..], Some(Json::Object(rules.collect()))),
            (&b"settings"[..], Some(settings)),
            (
                &b"env"[..],
                Some(json.get(b"env").cloned().unwrap_or(builtin)),
            ),
            (
                &b"globals"[..],
                Some(printed_globals(json).unwrap_or_else(empty)),
            ),
            (
                &b"overrides"[..],
                has_overrides.then_some(Json::Array(overrides)),
            ),
            (&b"options"[..], json.get(b"options").cloned()),
            (
                &b"ignorePatterns"[..],
                Some(ignored.unwrap_or_else(|| Json::Array(Vec::new()))),
            ),
            (&b"extends"[..], json.get(b"extends").cloned()),
        ];
        let entries = entries.into_iter();
        entries
            .filter_map(|(key, it)| Some((key.to_vec(), it?)))
            .collect()
    }

    /// The part of oxlint rules' `should_run` that depends on the kind of file, as objects that turn rules off
    /// regardless of the rest of the config.
    fn rules_by_file_kind(&self) -> Vec<ConfigObject> {
        let kinds: [(&[u8], &[(&str, &str)]); 3] = [
            (b"**/*.{js,mjs,cjs,jsx}", categories::TYPESCRIPT_ONLY),
            (b"**/*.{ts,mts,cts,tsx}", categories::NOT_TYPESCRIPT),
            (b"**/*.d.{ts,mts,cts}", categories::NOT_DECLARATIONS),
        ];
        let objects = kinds.into_iter().map(|(files, lists)| {
            let mut rules = Vec::new();
            let is_on = |it: Plugin| it.is_always_available() || is_among(it, &self.plugins);
            self.add_settings(lists, Severity::Off, &is_on, &mut rules);
            ConfigObject {
                files: Some(vec![vec![Pattern::new(files)]]),
                rules,
                ..ConfigObject::default()
            }
        });
        objects.collect()
    }
}

impl Config {
    /// Builds a config from an `.oxlintrc.json`. `base_path` is the absolute path of the file's directory.
    ///
    /// `load(directory, name)` reads a file listed in `extends`, relative to `directory`. It isn't called for the
    /// configs that ESLint and typescript-eslint publish: `eslint:recommended`,
    /// `plugin:@typescript-eslint/recommended`, `typescript-eslint/strict`, ..
    ///
    /// The plugins listed in `jsPlugins` are skipped, with a note.
    pub fn from_rc_json(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
        load: &mut dyn FnMut(&[u8], &[u8]) -> Option<Json>,
    ) -> Result<Config, ConfigError> {
        Self::from_rc(registry, base_path, json, load, None)
    }

    /// Like [`Config::from_rc_json`], but loads the plugins listed in `jsPlugins`.
    pub fn from_rc_json_with_plugins(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
        load: &mut dyn FnMut(&[u8], &[u8]) -> Option<Json>,
        load_plugin: &mut LoadPlugin<'_>,
    ) -> Result<Config, ConfigError> {
        Self::from_rc(registry, base_path, json, load, Some(load_plugin))
    }

    fn from_rc<'l>(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
        load: &'l mut dyn FnMut(&[u8], &[u8]) -> Option<Json>,
        load_plugin: Option<&'l mut LoadPlugin<'l>>,
    ) -> Result<Config, ConfigError> {
        let base_path = paths::absolute(base_path);
        let categories = vec![(b"correctness".to_vec(), Severity::Warn)];
        let mut rc = Rc {
            reader: Reader {
                registry,
                base_path: base_path.clone(),
                prefers_typescript_rules: true,
                has_every_rule: false,
                objects: Vec::new(),
                notes: Vec::new(),
                advice: Vec::new(),
                unknown_rules: Vec::new(),
                js_plugins: Vec::new(),
                js_plugin_location_indices: Vec::new(),
                js_locations: Vec::new(),
                defaults: 0,
                foreign_prefixes: Vec::new(),
                named: 0,
                has_unknown_resolver: false,
                plugins_handing_back: Vec::new(),
            },
            load,
            load_plugin,
            categories: categories.clone(),
            file_categories: categories,
            plugins: Vec::new(),
            overrides: Vec::new(),
            options: Vec::new(),
            file_plugins: Vec::new(),
            override_rules: Vec::new(),
            named_plugins: None,
        };
        rc.reader.objects.push(ConfigObject {
            files: Some(vec![vec![Pattern::new(LINTED_FILES)]]),
            ..ConfigObject::default()
        });
        // oxlint's built-in ignores. `node_modules` isn't one of them, because a `.gitignore` covers it.
        let ignored: [&[u8]; 5] = [
            b"**/.git/",
            b"**/.jj/",
            b"**/*.min.*",
            b"**/*-min.*",
            b"**/*_min.*",
        ];
        rc.reader.objects.push(ConfigObject {
            ignores: Some(ignored.iter().map(|it| Pattern::new(it)).collect()),
            is_global_ignores: true,
            ..ConfigObject::default()
        });
        // A placeholder for the categories' rules, which are only known once all files are read.
        let categories_at = rc.reader.objects.len();
        rc.reader.objects.push(ConfigObject::default());
        rc.file(json, &base_path, false)?;
        rc.reader.objects[categories_at].rules =
            rc.category_rules(&rc.categories, &|it| rc.has_plugin(it));
        rc.reader.objects[categories_at].without_rules =
            rc.without_rules(&rc.categories, &|it| rc.has_plugin(it));
        let lacking = rc.missing_category_rules();
        if !lacking.is_empty() {
            rc.reader.note(&[
                lacking.len().to_string().as_bytes(),
                match lacking.len() {
                    1 => &b" rule enabled by \"categories\" is not supported yet and did not run: "[..],
                    _ => b" rules enabled by \"categories\" are not supported yet and did not run: ",
                },
                &lacking.join(&b", "[..]),
            ]);
        }
        let oxlint_print_config = rc.printed(json, categories_at);
        // A setting for a rule of a plugin that isn't on has no effect.
        let mut objects = std::mem::take(&mut rc.reader.objects);
        for object in &mut objects {
            (object.rules).retain(|it| it.builtin_plugin.is_none_or(|it| rc.has_plugin(it)));
        }
        objects.append(&mut rc.take_overrides());
        rc.reader.objects = objects;
        let is_off = |id: &[u8]| {
            let plugin = parse_rule_id(id).0;
            PLUGIN_NAMES.contains(&plugin)
                && !(rc.plugins.iter()).any(|it| canonical_oxlint_plugin(it) == plugin)
        };
        // A rule from an extended file that the extending file turns off stays off, unless an override turns it on.
        let is_on = |id: &[u8]| {
            let settings = |are_of_overrides: bool| {
                let objects = rc.reader.objects.iter();
                let objects = objects.filter(move |it| it.files.is_some() == are_of_overrides);
                objects.flat_map(|it| &it.rules).filter(|it| *it.id == *id)
            };
            settings(false)
                .next_back()
                .is_some_and(|it| it.severity != Severity::Off)
                || settings(true).any(|it| it.severity != Severity::Off)
        };
        let mut unknown_rules = std::mem::take(&mut rc.reader.unknown_rules);
        unknown_rules.retain(|id| !is_off(id) && is_on(id));
        rc.reader.unknown_rules = unknown_rules;
        let mut by_kind_of_file = rc.rules_by_file_kind();
        rc.reader.objects.append(&mut by_kind_of_file);
        let oxlintrc_options = std::mem::take(&mut rc.options);
        Ok(Config {
            // `oxc/no-barrel-file` depends on this.
            without_modules: !rc.has_plugin(Plugin::Import),
            oxlintrc_options,
            oxlint_print_config,
            ..rc.reader.finish(Semantics {
                keeps_options: false,
                accepts_all_plugins: true,
                is_legacy: false,
            })
        })
    }

    /// Returns oxlint's error for the shape of `json`, a whole `.oxlintrc.json`, before its contents are interpreted.
    pub fn check_shape_for_oxlint(json: &Json) -> Result<(), ConfigError> {
        shape::check(json)
    }
}
