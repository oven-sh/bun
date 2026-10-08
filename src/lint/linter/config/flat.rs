//! Reads ESLint's flat configuration from JSON.

use super::merge::RuleSetting;
use super::{Config, ConfigObject, Pattern, path, presets};
use crate::context::Severity;
use crate::linter::registry::{Registry, parse_rule_id};
use crate::options::Json;

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

/// What is collected while the objects are read.
pub(super) struct Reader<'r> {
    pub(super) registry: &'r Registry,
    pub(super) base_path: Vec<u8>,
    pub(super) prefers_typescript_rules: bool,
    pub(super) objects: Vec<ConfigObject>,
    pub(super) notes: Vec<Vec<u8>>,
    pub(super) unknown_rules: Vec<Box<[u8]>>,
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

impl Reader<'_> {
    pub(super) fn note(&mut self, parts: &[&[u8]]) {
        let note = parts.concat();
        if !self.notes.contains(&note) {
            self.notes.push(note);
        }
    }

    fn patterns(&mut self, key: &str, items: &[Json]) -> Result<Vec<Pattern>, ConfigError> {
        let mut patterns = Vec::with_capacity(items.len());
        for item in items {
            match item {
                Json::String(pattern) => patterns.push(Pattern::new(pattern)),
                Json::Object(_) if item.get(b"$unserializable").is_some() => {
                    self.note(&[
                        b"A function in \"",
                        key.as_bytes(),
                        b"\" is not supported. It never matches.",
                    ]);
                    // An empty pattern matches the empty path only.
                    patterns.push(Pattern::new(b""));
                }
                _ => {
                    return Err(ConfigError::new(&[
                        b"Expected array to only contain strings and functions.",
                    ]));
                }
            }
        }
        Ok(patterns)
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
            match self
                .registry
                .find_preferring(id, self.prefers_typescript_rules)
            {
                Some(entry) => {
                    setting.id = crate::linter::RuleId::Known(entry.meta).to_vec().into()
                }
                None if setting.severity == Severity::Off => continue,
                None => {
                    if !self.unknown_rules.iter().any(|it| **it == *id) {
                        self.unknown_rules.push(id.into());
                    }
                    continue;
                }
            }
            settings.push(setting);
        }
        Ok(settings)
    }

    /// One object of a flat configuration, without its `extends`.
    pub(super) fn object(&mut self, json: &Json) -> Result<ConfigObject, ConfigError> {
        let Some(entries) = json.as_object() else {
            return Err(ConfigError::new(&[match json {
                Json::Null => b"Unexpected null config.",
                _ => &b"Unexpected non-object config."[..],
            }]));
        };
        let mut object = ConfigObject::default();
        if let Some(base_path) = json.get(b"basePath") {
            let Some(base_path) = base_path.as_str() else {
                return Err(ConfigError::new(&[
                    b"Key \"basePath\": Expected value to be a string.",
                ]));
            };
            object.base_path = Some(path::resolve(&self.base_path, base_path));
        }
        if let Some(files) = json.get(b"files") {
            let Some(files) = files.as_array().filter(|it| !it.is_empty()) else {
                return Err(ConfigError::new(&[
                    b"Key \"files\": Expected value to be a non-empty array.",
                ]));
            };
            let mut alternatives = Vec::with_capacity(files.len());
            for item in files {
                alternatives.push(match item {
                    Json::Array(all) => self.patterns("files", all)?,
                    item => self.patterns("files", std::slice::from_ref(item))?,
                });
            }
            object.files = Some(alternatives);
        }
        if let Some(ignores) = json.get(b"ignores") {
            let Some(ignores) = ignores.as_array() else {
                return Err(ConfigError::new(&[
                    b"Key \"ignores\": Expected value to be an array.",
                ]));
            };
            object.ignores = Some(self.patterns("ignores", ignores)?);
            object.is_global_ignores = entries
                .iter()
                .filter(|it| !META_KEYS.contains(&&it.0[..]))
                .count()
                == 1;
        }
        let mut typescript_prefixes: Vec<&[u8]> = Vec::new();
        for (prefix, name) in json
            .get(b"plugins")
            .and_then(Json::as_object)
            .unwrap_or_default()
        {
            match name.as_str() {
                _ if matches!(&prefix[..], b"@" | b"@typescript-eslint") => {}
                Some(name) if is_typescript_plugin(name) => typescript_prefixes.push(prefix),
                _ => object.foreign_plugins.push(prefix[..].into()),
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
        let mut reader = Reader {
            registry,
            base_path: path::resolve(b"/", base_path),
            prefers_typescript_rules: false,
            objects: Vec::new(),
            notes: Vec::new(),
            unknown_rules: Vec::new(),
        };
        let defaults = crate::json::parse(DEFAULT_CONFIG).unwrap_or(Json::Null);
        for object in defaults.as_array().unwrap_or_default() {
            reader.object_with_extends(object)?;
        }
        fn read(reader: &mut Reader, json: &Json, depth: usize) -> Result<(), ConfigError> {
            match json {
                Json::Array(items) if depth < 64 => items
                    .iter()
                    .try_for_each(|item| read(reader, item, depth + 1)),
                json => reader.object_with_extends(json),
            }
        }
        read(&mut reader, json, 0)?;
        Ok(reader.finish(true, false))
    }
}

impl Reader<'_> {
    pub(super) fn finish(self, keeps_options: bool, accepts_all_plugins: bool) -> Config {
        Config {
            base_path: self.base_path,
            objects: self.objects,
            keeps_options,
            accepts_all_plugins,
            prefers_typescript_rules: self.prefers_typescript_rules,
            notes: self.notes,
            unknown_rules: self.unknown_rules,
            cache: Default::default(),
        }
    }
}
