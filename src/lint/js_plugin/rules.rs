//! Plugin metadata on this side, and a plugin's rules as a config sets them up.

use super::scopes::ConfiguredGlobals;
use crate::language::{Global, LanguageOptions, SourceType};
use crate::linter::globals::config_globals_in_order;
use crate::linter::{write_json, write_json_with};
use crate::options::Json;
use crate::rule::Kind;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

/// ESLint's `meta.schema`.
#[derive(Clone, PartialEq, Debug)]
pub enum Schema {
    /// No schema: the rule takes no options.
    None,
    /// `false`: the options aren't validated.
    Any,
    /// An array with one schema per option, or one schema for the whole options array.
    Json(Json),
}

/// A plugin's rule.
#[derive(Debug)]
pub struct Rule {
    /// ESLint's `ruleId`: `<plugin>/<rule>`, or `<rule>` for a plugin without a name.
    pub id: Box<[u8]>,
    /// `meta.type`
    pub kind: Option<Kind>,
    /// `meta.fixable` is set.
    pub is_fixable: bool,
    /// `meta.hasSuggestions`
    pub has_suggestions: bool,
    pub schema: Schema,
    /// `meta.defaultOptions`
    pub default_options: Vec<Json>,
    /// `meta.deprecated`, if it's truthy in JavaScript, and `meta.replacedBy`.
    pub deprecated: Option<Box<(Json, Json)>>,
    /// No module exports the rule or its plugin, so a realm has to run the whole config file to get it.
    pub needs_config_file: bool,
    /// JSON: the module that exports the rule itself, if there is one. A realm loads that instead of the plugin.
    pub(super) location: Option<Box<[u8]>>,
    /// Its plugin's index among the plugins.
    pub(super) plugin: u32,
    /// Its number among the rules of all plugins.
    pub(super) index: u32,
}

/// A loaded plugin.
#[derive(Debug)]
pub struct Plugin {
    /// The prefix of its rules.
    pub name: Box<[u8]>,
    /// `{ module, export }`: the file it's in, with the path as Node.js writes it, and where it is in that file's
    /// exports. `None` for a plugin that was found in a config.
    pub location: Option<Json>,
    /// `meta.name@meta.version`, as ESLint prints a plugin.
    pub id: Option<Box<[u8]>>,
    /// It has none of a plugin's properties: no `meta`, no `rules`.
    pub has_no_plugin_properties: bool,
    /// Sorted by [`Rule::id`].
    pub rules: Vec<Arc<Rule>>,
}

impl Rule {
    /// JSON: the module that exports the rule itself, if there is one.
    pub(crate) fn location(&self) -> Option<&[u8]> {
        self.location.as_deref()
    }
}

impl Plugin {
    /// The rule that the plugin calls `name`.
    pub fn rule(&self, name: &[u8]) -> Option<&Arc<Rule>> {
        let skipped = self.name.len() + usize::from(!self.name.is_empty());
        let at = self
            .rules
            .binary_search_by(|it| it.id.get(skipped..).unwrap_or_default().cmp(name));
        Some(&self.rules[at.ok()?])
    }
}

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

/// A rule and its options.
#[derive(Debug)]
pub struct Configured {
    pub rule: Arc<Rule>,
    pub(super) id: u32,
    /// `[rule, options, id, location, plugin]`
    pub(super) json: Box<[u8]>,
}

/// [`write_json`], except that it keeps the infinite numbers that default options can have, by writing a number too
/// large for a double.
fn write_option(out: &mut Vec<u8>, value: &Json) {
    write_json_with(out, value, |out, number| match number {
        f64::INFINITY => out.extend_from_slice(b"1e999"),
        f64::NEG_INFINITY => out.extend_from_slice(b"-1e999"),
        _ if number.is_nan() => out.extend_from_slice(b"{\"$number\":\"NaN\"}"),
        _ => write_json(out, &Json::Number(number)),
    });
}

impl Configured {
    /// `options` is ESLint's `context.options`, with the rule's default options merged in.
    pub fn new(rule: Arc<Rule>, options: &[Json]) -> Arc<Configured> {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let mut json = format!("[{},[", rule.index).into_bytes();
        for (i, option) in options.iter().enumerate() {
            if i > 0 {
                json.push(b',');
            }
            write_option(&mut json, option);
        }
        json.extend_from_slice(b"],");
        write_json(&mut json, &Json::String(rule.id.to_vec()));
        json.push(b',');
        json.extend_from_slice(rule.location.as_deref().unwrap_or(b"null"));
        json.extend_from_slice(format!(",{}]", rule.plugin).as_bytes());
        Arc::new(Configured {
            rule,
            id,
            json: json.into(),
        })
    }
}

/// The data a config gives rules besides their options: ESLint's `context.settings` and `context.languageOptions`.
#[derive(Debug)]
pub struct FileSettings {
    pub(super) id: u32,
    /// `{ settings, languageOptions, globals, freezes, isLegacy, parser }`
    pub(super) json: Box<[u8]>,
    /// ESLint's `configGlobals`, or what oxlint defines, in the key order of `globals` in `json`.
    pub(super) globals: ConfiguredGlobals,
    /// JSON: `[{ config, index }, ..]`, the config file objects that the settings were merged from. It's only set if
    /// the settings contain something JSON can't represent, like a function. A realm then takes them from those
    /// objects.
    pub(super) sources: Option<Box<[u8]>>,
}

/// True if `json` contains a value from the config file that JSON can't represent.
pub(crate) fn has_non_json_value(json: &Json) -> bool {
    match json {
        Json::Array(items) => items.iter().any(has_non_json_value),
        Json::Object(entries) => {
            (entries.iter()).any(|it| it.0 == b"$unserializable" || has_non_json_value(&it.1))
        }
        Json::Number(it) => !it.is_finite(),
        _ => false,
    }
}

impl FileSettings {
    /// `sources` are the `$source`s of the `eslint.config.js` objects that `language` was merged from, in order.
    /// `parser` is the `$parser` of the object that `languageOptions.parser` came from.
    pub fn from_objects(
        language: &LanguageOptions,
        sources: &[&Json],
        parser: Option<&Json>,
    ) -> Arc<FileSettings> {
        let sources = has_non_json_value(&language.settings).then(|| {
            let sources = sources.iter().map(|it| (*it).clone());
            let mut sources_json = Vec::new();
            write_json(&mut sources_json, &Json::Array(sources.collect()));
            sources_json.into()
        });
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let string = |text: &[u8]| Json::String(text.to_vec());
        // oxlint only puts the entries of `globals` itself there.
        let config_globals = match language.is_oxlint {
            true => &language.own_globals,
            false => &language.globals,
        };
        let globals = config_globals.iter().map(|(name, setting)| {
            let setting: &[u8] = match setting {
                Global::Readonly => b"readonly",
                Global::Writable => b"writable",
                Global::Off => b"off",
            };
            (name.to_vec(), string(setting))
        });
        let source_type: &[u8] = match language.source_type {
            SourceType::Module => b"module",
            SourceType::Script => b"script",
            SourceType::CommonJs => b"commonjs",
        };
        let mut language_options = vec![
            (
                b"ecmaVersion".to_vec(),
                Json::Number(f64::from(language.ecma_version)),
            ),
            (b"sourceType".to_vec(), string(source_type)),
            (b"globals".to_vec(), Json::Object(globals.collect())),
            (
                b"parserOptions".to_vec(),
                match &language.parser_options {
                    Json::Null => Json::Object(Vec::new()),
                    options => options.clone(),
                },
            ),
        ];
        if language.is_oxlint {
            let envs = language.envs.iter();
            let envs = envs.map(|it| (it.to_vec(), Json::Bool(true)));
            language_options.push((b"env".to_vec(), Json::Object(envs.collect())));
        }
        let language_options = Json::Object(language_options);
        let settings = match &*language.settings {
            Json::Null => Json::Object(Vec::new()),
            // Keys that begin with `$` are Bun's own.
            Json::Object(entries) => {
                let user_entries = entries.iter().filter(|it| !it.0.starts_with(b"$"));
                Json::Object(user_entries.cloned().collect())
            }
            settings => settings.clone(),
        };
        // ESLint's `configGlobals`.
        let setting_name = |setting: Global| -> &'static [u8] {
            match setting {
                Global::Readonly => b"readonly",
                Global::Writable => b"writable",
                Global::Off => b"off",
            }
        };
        let globals = match language.is_oxlint {
            true => ConfiguredGlobals::new(language.oxlint_plugin_globals(), std::iter::empty()),
            false => {
                let globals = config_globals_in_order(language)
                    .into_iter()
                    .map(|(name, setting)| (name.into_owned().into(), setting));
                ConfiguredGlobals::new(globals.collect(), language.lib_variables())
            }
        };
        let all_globals = globals
            .iter()
            .map(|(name, setting)| (name.to_vec(), string(setting_name(*setting))))
            .collect();
        let all = Json::Object(vec![
            (b"settings".to_vec(), settings),
            (b"languageOptions".to_vec(), language_options),
            (b"globals".to_vec(), Json::Object(all_globals)),
            (b"freezes".to_vec(), Json::Bool(language.is_oxlint)),
            (
                b"isLegacy".to_vec(),
                Json::Bool(language.eslint_8.is_some()),
            ),
            (b"parser".to_vec(), parser.cloned().unwrap_or(Json::Null)),
        ]);
        let mut json = Vec::new();
        write_json(&mut json, &all);
        Arc::new(FileSettings {
            id,
            json: json.into(),
            globals,
            sources,
        })
    }
}
