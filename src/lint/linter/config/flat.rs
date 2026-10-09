//! Reads ESLint's flat configuration from JSON.

use super::merge::RuleSetting;
use super::{Config, ConfigObject, Pattern, path, presets};
use crate::context::Severity;
use crate::js_plugin;
use crate::linter::registry::{Registry, parse_rule_id};
use crate::linter::resolved::find_js_rule;
use crate::options::Json;
use crate::rule::Plugin;
use std::sync::Arc;

/// Why a configuration cannot be used. The text is ESLint's where ESLint has one.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ConfigError {
    pub message: Vec<u8>,
}

impl ConfigError {
    pub(super) fn new(parts: &[&[u8]]) -> ConfigError {
        ConfigError {
            message: parts.concat(),
        }
    }
}

/// Loads a JavaScript plugin: [`Host::load_located`](crate::js_plugin::Host). It is given what `$jsPlugins` has for the plugin, and
/// the prefix of its rules.
pub type LoadLocatedPlugin<'l> =
    dyn FnMut(&Json, &[u8]) -> Result<Arc<js_plugin::Plugin>, Vec<u8>> + 'l;

/// What depends on the kind of the configuration file: the fields of these names of [`Config`].
#[derive(Copy, Clone)]
pub(super) struct Semantics {
    pub(super) keeps_options: bool,
    pub(super) accepts_all_plugins: bool,
    pub(super) is_legacy: bool,
}

/// What is collected while the objects are read.
pub(super) struct Reader<'r> {
    pub(super) registry: &'r Registry,
    pub(super) base_path: Vec<u8>,
    pub(super) prefers_typescript_rules: bool,
    pub(super) objects: Vec<ConfigObject>,
    pub(super) notes: Vec<Vec<u8>>,
    pub(super) unknown_rules: Vec<Box<[u8]>>,
    /// The JavaScript plugins that are loaded.
    pub(super) js_plugins: Vec<Arc<js_plugin::Plugin>>,
    /// `$jsPlugins`: where the plugin with a prefix can be loaded from.
    pub(super) js_locations: Vec<(Box<[u8]>, Json)>,
    /// How many of the objects are ESLint's own.
    pub(super) defaults: usize,
}

fn is_typescript_plugin(name: &[u8]) -> bool {
    let name = match bun_core::strings::last_index_of_char(name, b'@') {
        Some(at) if at > 0 => &name[..at],
        _ => name,
    };
    matches!(
        name,
        b"@typescript-eslint/eslint-plugin" | b"typescript-eslint" | b"@typescript-eslint"
    )
}

const META_KEYS: [&[u8]; 2] = [b"name", b"basePath"];

/// `Config "name": ` or `Config (unnamed): `, which the message of a `ConfigError` starts with.
fn config_name(json: &Json) -> Vec<u8> {
    match json.get(b"name").and_then(Json::as_str) {
        Some(name) if !name.is_empty() => [b"Config \"", name, b"\": "].concat(),
        _ => b"Config (unnamed): ".to_vec(),
    }
}

/// `ValidationStrategy.object`
fn is_object(value: &Json) -> bool {
    matches!(value, Json::Object(_) | Json::Array(_))
}

/// How `flatConfigSchema` validates `linterOptions`.
fn validate_linter_options(value: &Json) -> Option<Vec<u8>> {
    if !is_object(value) {
        return Some(b"Expected an object.".to_vec());
    }
    let is_severity = |it: &Json| crate::linter::severity_of(it).is_some();
    for (key, value) in value.as_object().unwrap_or_default() {
        let problem: Option<&[u8]> = match &key[..] {
            b"noInlineConfig" => value.as_bool().is_none().then_some(b"Expected a boolean."),
            b"reportUnusedDisableDirectives" => (!is_severity(value) && value.as_bool().is_none())
                .then_some(
                    b"Expected one of: \"error\", \"warn\", \"off\", 0, 1, 2, or a boolean.",
                ),
            b"reportUnusedInlineConfigs" => (!is_severity(value))
                .then_some(b"Expected one of: \"error\", \"warn\", \"off\", 0, 1, or 2."),
            _ => return Some([b"Unexpected key \"", &key[..], b"\" found."].concat()),
        };
        if let Some(problem) = problem {
            return Some([b"Key \"", &key[..], b"\": ", problem].concat());
        }
    }
    None
}

/// `ObjectSchema.validate` with `flatConfigSchema`: what is wrong with a configuration object. ESLint
/// finds out when the object is merged, so only if it matches a file.
fn validate_object(entries: &[(Vec<u8>, Json)]) -> Option<Vec<u8>> {
    let expected_object = || Some(b"Expected an object.".to_vec());
    for (key, value) in entries {
        let problem: Option<Vec<u8>> = match &key[..] {
            b"basePath" | b"files" | b"ignores" | b"language" | b"processor" => None,
            b"name" if value.as_str().is_none() => Some(b"Property must be a string.".to_vec()),
            b"name" => None,
            b"settings" | b"languageOptions" if !is_object(value) => expected_object(),
            b"settings" | b"languageOptions" => None,
            b"linterOptions" => validate_linter_options(value),
            b"plugins" => match value {
                Json::Object(_) => None,
                Json::Array(_) => Some(
                    b"This appears to be in eslintrc format (array of strings) rather than flat config format (object)."
                        .to_vec(),
                ),
                _ => expected_object(),
            },
            // Not of ESLint: see `Config::from_flat_json_with_plugins`.
            b"$jsPlugins" | b"$processor" | b"$source" => None,
            b"rules" if !is_object(value) => expected_object(),
            b"rules" => (value.as_object().unwrap_or_default().iter())
                .find(|it| it.0 != b"__proto__" && RuleSetting::new(&it.0, &it.1).is_none())
                .map(|(id, _)| {
                    [
                        b"Key \"",
                        &id[..],
                        b"\": Expected severity of \"off\", 0, \"warn\", 1, \"error\", or 2.",
                    ]
                    .concat()
                }),
            b"env" | b"extends" | b"globals" | b"ignorePatterns" | b"noInlineConfig"
            | b"overrides" | b"parser" | b"parserOptions" | b"reportUnusedDisableDirectives"
            | b"root" => Some(
                b"This appears to be in eslintrc format rather than flat config format.".to_vec(),
            ),
            _ => return Some([b"Unexpected key \"", &key[..], b"\" found."].concat()),
        };
        if let Some(problem) = problem {
            return Some([b"Key \"", &key[..], b"\": ", &problem].concat());
        }
    }
    None
}

impl Reader<'_> {
    pub(super) fn note(&mut self, parts: &[&[u8]]) {
        let note = parts.concat();
        if !self.notes.contains(&note) {
            self.notes.push(note);
        }
    }

    /// The patterns in `items`, which are validated already. `json`: the object that has them.
    fn patterns(
        &self,
        json: &Json,
        key: &str,
        items: &[Json],
    ) -> Result<Vec<Pattern>, ConfigError> {
        let patterns = items.iter().map(|item| match item {
            Json::String(pattern) => Ok(Pattern::new(pattern)),
            // Which files it is for cannot be told. To lint fewer files than ESLint and find no problems is worse than not to lint.
            _ => {
                let index = self.objects.len().saturating_sub(self.defaults).to_string();
                Err(ConfigError::new(&[
                    &config_name(json),
                    b"Key \"",
                    key.as_bytes(),
                    b"\": A function is not supported, at user-defined index ",
                    index.as_bytes(),
                    b".\n`FlatCompat` of @eslint/eslintrc makes one of each of the `overrides`, and of the `ignorePatterns`, of what it is given.",
                ]))
            }
        });
        patterns.collect()
    }

    /// The rules of an object. `typescript_prefixes`: other names under which the plugin of
    /// typescript-eslint is configured.
    pub(super) fn rules(
        &mut self,
        rules: &Json,
        typescript_prefixes: &[&[u8]],
    ) -> Result<Vec<RuleSetting>, ConfigError> {
        let mut settings = Vec::new();
        for (id, value) in rules.as_object().unwrap_or_default() {
            if id == b"__proto__" {
                continue;
            }
            let (prefix, name) = parse_rule_id(id);
            let renamed;
            let id: &[u8] = match typescript_prefixes.contains(&prefix) {
                true => {
                    renamed = [b"@typescript-eslint/", name].concat();
                    &renamed
                }
                false => id,
            };
            let Some(mut setting) = RuleSetting::new(id, value) else {
                return Err(ConfigError::new(&[
                    b"Key \"rules\": Key \"",
                    id,
                    b"\": Expected severity of \"off\", 0, \"warn\", 1, \"error\", or 2.",
                ]));
            };
            if let Some(found) = find_js_rule(&self.js_plugins, id) {
                // Also for a rule that is off, as in oxlint.
                if found.is_none() {
                    return Err(ConfigError::new(&[
                        b"Rule '",
                        name,
                        b"' not found in plugin '",
                        prefix,
                        b"'",
                    ]));
                }
                setting.plugin = prefix.into();
                settings.push(setting);
                continue;
            }
            setting.written_for = match self.prefers_typescript_rules {
                true => Plugin::of_oxlint_prefix(prefix),
                false => Plugin::of_prefix(prefix),
            };
            if !matches!(prefix, b"eslint" | b"typescript" | b"typescript-eslint") {
                setting.plugin = parse_rule_id(id).0.into();
            }
            match self
                .registry
                .find_preferring(id, self.prefers_typescript_rules)
            {
                Some(entry) => {
                    setting.id = crate::linter::RuleId::Known(entry.meta).to_vec().into()
                }
                None => {
                    let is_new = !self.unknown_rules.iter().any(|it| **it == *id);
                    if setting.severity != Severity::Off && is_new {
                        self.unknown_rules.push(id.into());
                    }
                }
            }
            settings.push(setting);
        }
        Ok(settings)
    }

    /// `assertValidBaseConfig`, with what `wrapConfigErrorWithDetails` adds.
    fn validate_base(&self, json: &Json) -> Result<(), ConfigError> {
        let is_matcher = |it: &Json| it.as_str().is_some() || it.get(b"$unserializable").is_some();
        let only_matchers: &[u8] = b"Expected array to only contain strings and functions";
        let problem: Option<(&[u8], &[u8])> = match json {
            Json::Null => Some((b"", b"Unexpected null config")),
            Json::Object(_) => None,
            _ => Some((b"", b"Unexpected non-object config")),
        };
        let problem = problem.or_else(|| {
            let base_path = json.get(b"basePath")?;
            (base_path.as_str().is_none())
                .then_some((&b"basePath"[..], &b"Expected value to be a string"[..]))
        });
        let problem = problem.or_else(|| {
            let Some(files) = json.get(b"files")?.as_array().filter(|it| !it.is_empty()) else {
                return Some((b"files", b"Expected value to be a non-empty array"));
            };
            files.iter().find_map(|item| match item {
                Json::Array(all) if all.iter().all(is_matcher) => None,
                Json::Array(_) => Some((&b"files"[..], only_matchers)),
                item if is_matcher(item) => None,
                _ => Some((
                    b"files",
                    b"Items must be a string, a function, or an array of strings and functions",
                )),
            })
        });
        let problem = problem.or_else(|| match json.get(b"ignores")?.as_array() {
            None => Some((&b"ignores"[..], &b"Expected value to be an array"[..])),
            Some(all) if all.iter().all(is_matcher) => None,
            Some(_) => Some((b"ignores", only_matchers)),
        });
        let Some((key, message)) = problem else {
            return Ok(());
        };
        let key = match key {
            b"" => Vec::new(),
            key => [b"Key \"", key, b"\": "].concat(),
        };
        let index = self.objects.len().saturating_sub(self.defaults).to_string();
        Err(ConfigError::new(&[
            &config_name(json),
            &key,
            message,
            b" at user-defined index ",
            index.as_bytes(),
            b".",
        ]))
    }

    /// One object of a flat configuration, without its `extends`.
    pub(super) fn object(&mut self, json: &Json) -> Result<ConfigObject, ConfigError> {
        self.validate_base(json)?;
        let entries = json.as_object().unwrap_or_default();
        let mut object = ConfigObject::default();
        if let Some(base_path) = json.get(b"basePath").and_then(Json::as_str) {
            object.base_path = Some(path::resolve(&self.base_path, base_path));
        }
        if let Some(files) = json.get(b"files").and_then(Json::as_array) {
            let mut alternatives = Vec::with_capacity(files.len());
            for item in files {
                alternatives.push(match item {
                    Json::Array(all) => self.patterns(json, "files", all)?,
                    item => self.patterns(json, "files", std::slice::from_ref(item))?,
                });
            }
            object.files = Some(alternatives);
        }
        if let Some(ignores) = json.get(b"ignores").and_then(Json::as_array) {
            object.ignores = Some(self.patterns(json, "ignores", ignores)?);
            object.is_global_ignores = entries
                .iter()
                .filter(|it| !META_KEYS.contains(&&it.0[..]))
                .count()
                == 1;
        }
        if let Some(message) = validate_object(entries) {
            object.error = Some([&config_name(json)[..], &message].concat());
            return Ok(object);
        }
        let mut typescript_prefixes: Vec<&[u8]> = Vec::new();
        for (prefix, name) in json
            .get(b"plugins")
            .and_then(Json::as_object)
            .unwrap_or_default()
        {
            match name.as_str() {
                _ if matches!(&prefix[..], b"@" | b"@typescript-eslint") => {
                    object.plugins.push(prefix[..].into());
                }
                Some(name) if is_typescript_plugin(name) => {
                    typescript_prefixes.push(prefix);
                    object.plugins.push(b"@typescript-eslint"[..].into());
                }
                // `eslint` and `typescript` are names that oxlint has, not what a plugin is called here.
                _ if matches!(
                    Plugin::of_prefix(prefix),
                    Some(plugin) if !matches!(plugin, Plugin::Eslint | Plugin::TypeScript)
                ) =>
                {
                    object.plugins.push(prefix[..].into());
                }
                _ => object.foreign_plugins.push(prefix[..].into()),
            }
        }
        for (prefix, location) in json
            .get(b"$jsPlugins")
            .and_then(Json::as_object)
            .unwrap_or_default()
        {
            if !self.js_locations.iter().any(|it| *it.0 == prefix[..]) {
                self.js_locations
                    .push((prefix[..].into(), location.clone()));
            }
        }
        for prefix in &typescript_prefixes {
            self.note(&[
                b"The rules of typescript-eslint are reported as \"@typescript-eslint/..\", not as \"",
                prefix,
                b"/..\". Comments have to name them so.",
            ]);
        }
        if let Some(rules) = json.get(b"rules") {
            object.rules = self.rules(rules, &typescript_prefixes)?;
        }
        let part = |key: &[u8]| json.get(key).cloned().unwrap_or(Json::Null);
        object.language_options = part(b"languageOptions");
        object.linter_options = part(b"linterOptions");
        object.settings = part(b"settings");
        object.language = json.get(b"language").and_then(Json::as_str).map(Box::from);
        object.processor = json.get(b"processor").and_then(Json::as_str).map(Box::from);
        object.source = json.get(b"$source").cloned();
        object.processor_location = json
            .get(b"$processor")
            .filter(|it| it.as_object().is_some())
            .map(js_plugin::Processor::new);
        Ok(object)
    }

    /// `processExtends` of `@eslint/config-helpers`: an object, after the objects that it extends.
    /// An element of `extends` is an object, an array of objects, or the name of one of the
    /// configurations that ESLint and typescript-eslint publish.
    pub(super) fn object_with_extends(&mut self, json: &Json) -> Result<(), ConfigError> {
        let Some(extends) = json.get(b"extends") else {
            let object = self.object(json)?;
            self.objects.push(object);
            return Ok(());
        };
        let Some(extends) = extends.as_array() else {
            return Err(ConfigError::new(&[
                b"The `extends` property must be an array.",
            ]));
        };
        let own: Vec<(Vec<u8>, Json)> = (json.as_object().unwrap_or_default().iter())
            .filter(|it| it.0 != b"extends")
            .cloned()
            .collect();
        let is_global_ignores = |entries: &[(Vec<u8>, Json)]| {
            entries
                .iter()
                .all(|it| matches!(&it.0[..], b"basePath" | b"ignores" | b"name"))
        };
        let own_json = Json::Object(own.clone());
        let mut extensions: Vec<Json> = Vec::new();
        for element in extends {
            match element {
                Json::String(name) => match presets::find(name) {
                    Some(preset) => extensions.extend(preset),
                    None => {
                        return Err(ConfigError::new(&[
                            b"Plugin config \"",
                            name,
                            b"\" not found.",
                        ]));
                    }
                },
                Json::Array(items) => extensions.extend(items.iter().cloned()),
                element => extensions.push(element.clone()),
            }
        }
        for extension in extensions {
            let Json::Object(mut entries) = extension else {
                return Err(ConfigError::new(&[b"Unexpected non-object config."]));
            };
            if entries.iter().any(|it| it.0 == b"basePath") {
                return Err(ConfigError::new(&[
                    b"'basePath' in `extends` is not allowed.",
                ]));
            }
            if entries.iter().any(|it| it.0 == b"extends") {
                return Err(ConfigError::new(&[b"Nested 'extends' is not allowed."]));
            }
            let find = |entries: &[(Vec<u8>, Json)], key: &[u8]| {
                entries.iter().find(|it| it.0 == key).map(|it| it.1.clone())
            };
            let put = |entries: &mut Vec<(Vec<u8>, Json)>, key: &[u8], value: Json| match entries
                .iter_mut()
                .find(|it| it.0 == key)
            {
                Some(entry) => entry.1 = value,
                None => entries.push((key.to_vec(), value)),
            };
            if !is_global_ignores(&entries) {
                if let Some(Json::Array(base_files)) = own_json.get(b"files") {
                    let extension_files = find(&entries, b"files");
                    let extension_files = extension_files
                        .as_ref()
                        .and_then(Json::as_array)
                        .unwrap_or_default();
                    put(
                        &mut entries,
                        b"files",
                        Json::Array(extend_files(base_files, extension_files)),
                    );
                }
                if let Some(Json::Array(base_ignores)) = own_json.get(b"ignores") {
                    let mut all = base_ignores.clone();
                    all.extend(
                        find(&entries, b"ignores")
                            .as_ref()
                            .and_then(Json::as_array)
                            .unwrap_or_default()
                            .iter()
                            .cloned(),
                    );
                    put(&mut entries, b"ignores", Json::Array(all));
                }
            }
            if let Some(base_path) = own_json.get(b"basePath") {
                put(&mut entries, b"basePath", base_path.clone());
            }
            let object = self.object(&Json::Object(entries))?;
            self.objects.push(object);
        }
        if !is_global_ignores(&own) {
            let object = self.object(&own_json)?;
            self.objects.push(object);
        }
        Ok(())
    }
}

/// `extendConfigFiles`: every combination of a pattern of the one and a pattern of the other.
fn extend_files(base: &[Json], extension: &[Json]) -> Vec<Json> {
    if extension.is_empty() {
        return base.to_vec();
    }
    if base.is_empty() {
        return extension.to_vec();
    }
    let all = |item: &Json| match item {
        Json::Array(items) => items.clone(),
        item => vec![item.clone()],
    };
    let mut out = Vec::with_capacity(base.len() * extension.len());
    for a in base {
        for b in extension {
            out.push(Json::Array([all(a), all(b)].concat()));
        }
    }
    out
}

/// ESLint's `defaultConfig`.
const DEFAULT_CONFIG: &[u8] = br#"[
    { "language": "@/js", "linterOptions": { "reportUnusedDisableDirectives": 1 } },
    { "ignores": ["**/node_modules/", ".git/"] },
    { "files": ["**/*.js", "**/*.mjs"] },
    { "files": ["**/*.cjs"], "languageOptions": { "sourceType": "commonjs", "ecmaVersion": "latest" } }
]"#;

impl Config {
    /// From an `eslint.config.*` that has been evaluated: see the [module](super). `base_path`: the
    /// directory that the file is in, absolute. An object can have `extends`, as if the file used
    /// `defineConfig()`.
    pub fn from_flat_json(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
    ) -> Result<Config, ConfigError> {
        Self::from_flat(registry, base_path, json, None)
    }

    /// The same, with the plugins that are not implemented here. An object has beside `plugins` the key `$jsPlugins`, with
    /// where each of its plugins can be loaded from, by its prefix. One is loaded if a rule of it is enabled that does not exist
    /// here. A rule that does exist here runs in place of the one of the plugin.
    pub fn from_flat_json_with_plugins(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
        load_plugin: &mut LoadLocatedPlugin<'_>,
    ) -> Result<Config, ConfigError> {
        Self::from_flat(registry, base_path, json, Some(load_plugin))
    }

    fn from_flat(
        registry: &Registry,
        base_path: &[u8],
        json: &Json,
        load_plugin: Option<&mut LoadLocatedPlugin<'_>>,
    ) -> Result<Config, ConfigError> {
        let mut reader = Reader {
            registry,
            base_path: path::resolve(b"/", base_path),
            prefers_typescript_rules: false,
            objects: Vec::new(),
            notes: Vec::new(),
            unknown_rules: Vec::new(),
            js_plugins: Vec::new(),
            js_locations: Vec::new(),
            defaults: 0,
        };
        let defaults = crate::json::parse(DEFAULT_CONFIG).unwrap_or(Json::Null);
        for object in defaults.as_array().unwrap_or_default() {
            reader.object_with_extends(object)?;
        }
        reader.defaults = reader.objects.len();
        fn read(reader: &mut Reader, json: &Json, depth: usize) -> Result<(), ConfigError> {
            match json {
                Json::Array(items) if depth < 64 => items
                    .iter()
                    .try_for_each(|item| read(reader, item, depth + 1)),
                json => reader.object_with_extends(json),
            }
        }
        read(&mut reader, json, 0)?;
        if let Some(load) = load_plugin {
            reader.load_js_plugins(load)?;
        }
        Ok(reader.finish(Semantics {
            keeps_options: true,
            accepts_all_plugins: false,
            is_legacy: false,
        }))
    }
}

impl Reader<'_> {
    /// Loads the plugins of which a rule is enabled that does not exist here.
    pub(super) fn load_js_plugins(
        &mut self,
        load: &mut LoadLocatedPlugin<'_>,
    ) -> Result<(), ConfigError> {
        for (prefix, location) in std::mem::take(&mut self.js_locations) {
            let mut unknown = self.unknown_rules.iter();
            if !unknown.any(|id| parse_rule_id(id).0 == &prefix[..]) {
                continue;
            }
            self.js_plugins
                .push(load(&location, &prefix).map_err(|why| {
                    ConfigError::new(&[b"Failed to load the plugin \"", &prefix, b"\": ", &why])
                })?);
        }
        let plugins = &self.js_plugins;
        self.unknown_rules
            .retain(|id| find_js_rule(plugins, id).is_none());
        Ok(())
    }

    pub(super) fn finish(self, semantics: Semantics) -> Config {
        Config {
            base_path: self.base_path,
            heads: super::Heads::new(&self.objects),
            objects: self.objects,
            keeps_options: semantics.keeps_options,
            accepts_all_plugins: semantics.accepts_all_plugins,
            is_legacy: semantics.is_legacy,
            prefers_typescript_rules: self.prefers_typescript_rules,
            options_of_oxlint: Vec::new(),
            printed_for_oxlint: Vec::new(),
            notes: self.notes,
            unknown_rules: self.unknown_rules,
            js_plugins: self.js_plugins,
            cache: Default::default(),
        }
    }
}
