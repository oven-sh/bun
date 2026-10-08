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
    /// What the workers know it by.
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
        let at = self.rules.binary_search_by(|it| it.id.get(skipped..).unwrap_or_default().cmp(name));
        Some(&self.rules[at.ok()?])
    }
}

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

/// A rule and its options. A worker is told once what they are.
#[derive(Debug)]
pub struct Configured {
    pub rule: Arc<Rule>,
    pub(super) id: u32,
    /// `[id, rule, options]`
    pub(super) json: Box<[u8]>,
}

impl Configured {
    /// `options`: ESLint's `context.options`, with the default options of the rule merged in.
    pub fn new(rule: Arc<Rule>, options: &[Json]) -> Arc<Configured> {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let mut json = format!("[{id},{},[", rule.index).into_bytes();
        for (i, option) in options.iter().enumerate() {
            if i > 0 {
                json.push(b',');
            }
            write_json(&mut json, option);
        }
        json.extend_from_slice(b"]]");
        Arc::new(Configured {
            rule,
            id,
            json: json.into(),
        })
    }
}

/// What a configuration has for the rules other than their options: ESLint's `context.settings` and
/// `context.languageOptions`. A worker is told once what they are.
#[derive(Debug)]
pub struct FileSettings {
    pub(super) id: u32,
    /// `[id, { settings, languageOptions, globals }]`
    pub(super) json: Box<[u8]>,
}

impl FileSettings {
    pub fn new(language: &LanguageOptions) -> Arc<FileSettings> {
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
            (b"ecmaVersion".to_vec(), Json::Number(f64::from(language.ecma_version))),
            (b"sourceType".to_vec(), string(source_type)),
            (b"globals".to_vec(), Json::Object(globals.collect())),
            (b"parserOptions".to_vec(), match &language.parser_options {
                Json::Null => Json::Object(Vec::new()),
                options => options.clone(),
            }),
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
        let all_globals = all_globals.map(|(name, setting)| (name.into_owned(), string(setting_name(setting)))).collect();
        let all = Json::Array(vec![
            Json::Number(f64::from(id)),
            Json::Object(vec![
                (b"settings".to_vec(), settings),
                (b"languageOptions".to_vec(), language_options),
                (b"globals".to_vec(), Json::Object(all_globals)),
            ]),
        ]);
        let mut json = Vec::new();
        write_json(&mut json, &all);
        Arc::new(FileSettings {
            id,
            json: json.into(),
        })
    }
}
