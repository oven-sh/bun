//! What is known here of a plugin, and what a configuration makes of its rules.

use crate::language::{Global, LanguageOptions, SourceType};
use crate::linter::globals::config_globals_in_order;
use crate::linter::write_json;
use crate::options::Json;
use crate::rule::Kind;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

/// ESLint's `meta.schema`.
#[derive(Clone, PartialEq, Debug)]
pub enum Schema {
    /// There is none: the rule takes no options.
    None,
    /// `false`: the options are not validated.
    Any,
    /// An array of the schemas of the options, or the schema of the array of options.
    Json(Json),
}

/// A rule of a plugin.
#[derive(Debug)]
pub struct Rule {
    /// ESLint's `ruleId`: `<plugin>/<rule>`.
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
    /// No module exports the rule or its plugin: a realm has to run the whole configuration file to get at it.
    pub needs_the_configuration: bool,
    /// JSON: the module that exports the rule itself, if there is one. A realm loads that, and not the plugin.
    pub(super) location: Option<Box<[u8]>>,
    /// The position of its plugin among the plugins.
    pub(super) plugin: u32,
    /// Its number among the rules of all plugins.
    pub(super) index: u32,
}

/// A plugin that is loaded.
#[derive(Debug)]
pub struct Plugin {
    /// The prefix of its rules.
    pub name: Box<[u8]>,
    /// Sorted by [`Rule::id`].
    pub rules: Vec<Arc<Rule>>,
}

impl Plugin {
    /// The rule that the plugin calls `name`.
    pub fn rule(&self, name: &[u8]) -> Option<&Arc<Rule>> {
        let skipped = self.name.len() + 1;
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

/// [`write_json`] that keeps an infinite number, which default options have: as a number too large for a double.
fn write_option(out: &mut Vec<u8>, value: &Json) {
    match value {
        Json::Number(value) if value.is_infinite() => {
            out.extend_from_slice(if *value > 0.0 { b"1e999" } else { b"-1e999" });
        }
        Json::Array(items) => {
            out.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_option(out, item);
            }
            out.push(b']');
        }
        Json::Object(entries) => {
            out.push(b'{');
            for (i, (key, value)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_json(out, &Json::String(key.clone()));
                out.push(b':');
                write_option(out, value);
            }
            out.push(b'}');
        }
        _ => write_json(out, value),
    }
}

impl Configured {
    /// `options`: ESLint's `context.options`, with the default options of the rule merged in.
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

/// What a configuration has for the rules other than their options: ESLint's `context.settings` and
/// `context.languageOptions`.
#[derive(Debug)]
pub struct FileSettings {
    pub(super) id: u32,
    /// `{ settings, languageOptions, globals, libs, freezes }`
    pub(super) json: Box<[u8]>,
    /// JSON: `[{ config, index }, ..]`, the objects of a configuration file that the settings are merged of, if there is
    /// something in them that JSON cannot say, like a function. A realm takes them from there.
    pub(super) sources: Option<Box<[u8]>>,
}

/// Whether there is something in `json` that the configuration file has and JSON has not.
fn has_what_json_lacks(json: &Json) -> bool {
    match json {
        Json::Array(items) => items.iter().any(has_what_json_lacks),
        Json::Object(entries) => {
            (entries.iter()).any(|it| it.0 == b"$unserializable" || has_what_json_lacks(&it.1))
        }
        _ => false,
    }
}

impl FileSettings {
    pub fn new(language: &LanguageOptions) -> Arc<FileSettings> {
        Self::from_objects(language, &[], None)
    }

    /// `sources`: `$source` of the objects of an `eslint.config.js` that `language` is merged of, in their order. `parser`:
    /// `$parser` of the one that `languageOptions.parser` is from.
    pub fn from_objects(
        language: &LanguageOptions,
        sources: &[&Json],
        parser: Option<&Json>,
    ) -> Arc<FileSettings> {
        let sources = has_what_json_lacks(&language.settings).then(|| {
            let sources = sources.iter().map(|it| (*it).clone());
            let mut written = Vec::new();
            write_json(&mut written, &Json::Array(sources.collect()));
            written.into()
        });
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let string = |text: &[u8]| Json::String(text.to_vec());
        let globals = language.globals.iter().map(|(name, setting)| {
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
        let language_options = Json::Object(vec![
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
        ]);
        let settings = match &language.settings {
            Json::Null => Json::Object(Vec::new()),
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
        let all_globals = config_globals_in_order(language).into_iter();
        let all_globals = all_globals
            .map(|(name, setting)| (name.into_owned(), string(setting_name(setting))))
            .collect();
        // 1: a type, 2: a value.
        let libs = language.lib_variables().map(|(name, is_type, is_value)| {
            (
                name.to_vec(),
                Json::Number(f64::from(u8::from(is_type) | (u8::from(is_value) << 1))),
            )
        });
        let all = Json::Object(vec![
            (b"settings".to_vec(), settings),
            (b"languageOptions".to_vec(), language_options),
            (b"globals".to_vec(), Json::Object(all_globals)),
            (b"libs".to_vec(), Json::Object(libs.collect())),
            (b"freezes".to_vec(), Json::Bool(language.is_oxlint)),
            (b"parser".to_vec(), parser.cloned().unwrap_or(Json::Null)),
        ]);
        let mut json = Vec::new();
        write_json(&mut json, &all);
        Arc::new(FileSettings {
            id,
            json: json.into(),
            sources,
        })
    }
}
