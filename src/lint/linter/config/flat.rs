//! Reads ESLint's flat configuration from JSON.

use super::ignore_lines::IgnoreLines;
use super::merge::RuleSetting;
use super::rc::strings_of;
use super::{Config, ConfigObject, Pattern, presets};
use crate::context::Severity;
use crate::js_plugin;
use crate::linter::registry::{Registry, parse_rule_id};
use crate::linter::resolved::{find_js_rule, needs_resolver};
use crate::options::Json;
use crate::paths;
use crate::rule::{Plugin, minor_of};
use crate::runner::RuleEntry;
use bun_core::strings;
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
    /// [`Config::advice`]
    pub(super) advice: Vec<Vec<u8>>,
    pub(super) unknown_rules: Vec<Box<[u8]>>,
    /// The JavaScript plugins that are loaded.
    pub(super) js_plugins: Vec<Arc<js_plugin::Plugin>>,
    /// `$jsPlugins`: where the plugin with a prefix can be loaded from.
    pub(super) js_locations: Vec<(Box<[u8]>, Json)>,
    /// How many of the objects are ESLint's own.
    pub(super) defaults: usize,
    /// The names of the plugins of the configuration that are not [built in](is_built_in).
    pub(super) foreign_prefixes: Vec<Box<[u8]>>,
    /// [`names_unknown_resolver`] somewhere.
    pub(super) has_unknown_resolver: bool,
    /// The names of the plugins of which a rule is on that is answered for here and can hand a file back.
    pub(super) handing_back: Vec<Box<[u8]>>,
}

/// Whether the plugin that a configuration has as `prefix` is the one that is implemented here: it has the name that is usual
/// for it. `name`: what the plugin says it is called, with its version, if it says so. Under another name, as `ts` or `node` in
/// `@antfu/eslint-config`, or if another plugin has the name, as `import-x` has `import` there, it runs as what it is:
/// JavaScript. So its rules are called what the configuration calls them, in reports and in comments.
fn is_built_in(prefix: &[u8], name: Option<&[u8]>) -> bool {
    let package = name.map(
        |name| match bun_core::strings::last_index_of_char(name, b'@') {
            Some(at) if at > 0 => &name[..at],
            _ => name,
        },
    );
    // ESLint has its own rules in a plugin that is called `@`.
    prefix == b"@" || Plugin::answers_in_place_of(prefix, package)
}

/// Adds the names of the plugins in `json`, which is what a configuration file exports or a part of it, that are not
/// [built in](is_built_in). An object can have the rules of a plugin that an object after it has.
fn add_foreign_prefixes(json: &Json, depth: usize, into: &mut Vec<Box<[u8]>>) {
    if let Json::Array(items) = json {
        for item in items.iter().filter(|_| depth < 64) {
            add_foreign_prefixes(item, depth + 1, into);
        }
        return;
    }
    let plugins = json.get(b"plugins").and_then(Json::as_object);
    for (prefix, name) in plugins.unwrap_or_default() {
        if !is_built_in(prefix, name.as_str()) && !into.iter().any(|it| **it == prefix[..]) {
            into.push(prefix[..].into());
        }
    }
    if let Some(extends) = json.get(b"extends") {
        add_foreign_prefixes(extends, depth + 1, into);
    }
}

/// The package that `name` is, or is a file of: eslint-config-next writes `require.resolve("eslint-import-resolver-node")`.
fn package_of(name: &[u8]) -> &[u8] {
    const FOLDER: &[u8] = b"node_modules";
    let after = strings::last_index_of(name, FOLDER).and_then(|at| name.get(at + FOLDER.len()..));
    let Some([b'/' | b'\\', inside @ ..]) = after else {
        return name;
    };
    let end_of_part =
        |from: usize| Some(from + strings::index_of_any(inside.get(from..)?, b"/\\")?);
    let end = match (inside.first(), end_of_part(0)) {
        (Some(b'@'), Some(scope)) => end_of_part(scope + 1),
        (_, end) => end,
    };
    &inside[..end.unwrap_or(inside.len())]
}

/// Whether `settings` has an `import/resolver`, or a parser in `import/parsers`, that the rules here do not do the same as, or a
/// regular expression that is not written as a string, which they do not read. The package answers then.
pub(super) fn names_unknown_resolver(settings: &Json) -> bool {
    let is_expression = |it: &Json| it.get(b"$regexp").is_some();
    let ignored = settings.get(b"import/ignore").and_then(Json::as_array);
    if ignored.unwrap_or_default().iter().any(is_expression)
        || settings
            .get(b"import/internal-regex")
            .is_some_and(is_expression)
    {
        return true;
    }
    let parsers = settings.get(b"import/parsers").and_then(Json::as_object);
    let is_known_parser = |name: &[u8]| {
        matches!(
            package_of(name),
            b"espree" | b"@typescript-eslint/parser" | b"@typescript-eslint\\parser"
        )
    };
    if (parsers.unwrap_or_default().iter()).any(|it| !is_known_parser(&it.0)) {
        return true;
    }
    let is_known = |name: &[u8]| {
        let name = package_of(name);
        let name = name
            .strip_prefix(b"eslint-import-resolver-")
            .unwrap_or(name);
        matches!(name, b"node" | b"typescript")
    };
    // `new Set(..)` throws at it.
    let core_modules = settings.get(b"import/core-modules");
    if matches!(
        core_modules,
        Some(Json::Bool(_) | Json::Number(_) | Json::Object(_))
    ) {
        return true;
    }
    // `resolverReducer`: it goes into arrays, and throws at what is no string and no object.
    let written = settings.get(b"import/resolver");
    let mut pending: Vec<&Json> = written.filter(|it| it.is_truthy()).into_iter().collect();
    while let Some(it) = pending.pop() {
        match it {
            Json::Array(items) => pending.extend(items),
            Json::String(name) if is_known(name) => {}
            Json::Object(entries) if entries.iter().all(|it| is_known(&it.0)) => {}
            Json::Null => {}
            _ => return true,
        }
    }
    false
}

/// The same for what a configuration file exports, or a part of it.
fn has_unknown_resolver(json: &Json, depth: usize) -> bool {
    if let Json::Array(items) = json {
        return depth < 64 && items.iter().any(|it| has_unknown_resolver(it, depth + 1));
    }
    json.get(b"settings").is_some_and(names_unknown_resolver)
        || (json.get(b"extends")).is_some_and(|it| has_unknown_resolver(it, depth + 1))
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
            b"$changesLinter" | b"$ignorePatterns" | b"$jsPlugins" | b"$parser" | b"$processor"
            | b"$source" => None,
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

    /// Says so if the rules here, which answer for the plugin with the prefix `prefix`, are those of a later version than the one
    /// that is installed. `name`: what the plugin says it is: `<package>@<version>`.
    pub(super) fn advise_about_version(&mut self, prefix: &[u8], name: &[u8]) {
        let Some(at) = bun_core::strings::last_index_of_char(name, b'@').filter(|at| *at > 0)
        else {
            return;
        };
        let (package, installed) = (&name[..at], &name[at + 1..]);
        let Some(ours) = Plugin::of_prefix(prefix).and_then(Plugin::follows) else {
            return;
        };
        if minor_of(installed).is_none_or(|it| Some(it) >= minor_of(ours.as_bytes())) {
            return;
        }
        let line = [
            package,
            b" ",
            installed,
            b" is installed; bun lint follows ",
            ours.as_bytes(),
            b".",
        ]
        .concat();
        if !self.advice.contains(&line) {
            self.advice.push(line);
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

    /// The rule here that answers for `id`. Without one, the plugin is loaded that the configuration has for it.
    pub(super) fn native_rule(&self, id: &[u8]) -> Option<&'static RuleEntry> {
        let prefix = parse_rule_id(id).0;
        let is_foreign = self.foreign_prefixes.iter().any(|it| **it == *prefix);
        (self
            .registry
            .find_preferring(id, self.prefers_typescript_rules))
        .filter(|it| !is_foreign && !(self.has_unknown_resolver && needs_resolver(it.meta)))
    }

    /// The rules of an object.
    pub(super) fn rules(&mut self, rules: &Json) -> Result<Vec<RuleSetting>, ConfigError> {
        let mut settings = Vec::new();
        for (id, value) in rules.as_object().unwrap_or_default() {
            if id == b"__proto__" {
                continue;
            }
            let id = &id[..];
            let (prefix, name) = parse_rule_id(id);
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
            let is_foreign = self.foreign_prefixes.iter().any(|it| **it == *prefix);
            setting.written_for = match self.prefers_typescript_rules {
                _ if is_foreign => None,
                true => Plugin::of_oxlint_prefix(prefix),
                false => Plugin::of_prefix(prefix),
            };
            if !matches!(prefix, b"eslint" | b"typescript" | b"typescript-eslint") {
                setting.plugin = parse_rule_id(id).0.into();
            }
            match self.native_rule(id) {
                Some(entry) => {
                    let is_new = !self.handing_back.iter().any(|it| **it == *prefix);
                    if entry.meta.hands_back && setting.severity != Severity::Off && is_new {
                        self.handing_back.push(prefix.into());
                    }
                    setting.id = crate::linter::RuleId::Known(entry.meta).to_vec().into()
                }
                // One more instance of a rule of ESLint, which is of no plugin.
                None if !is_foreign && self.registry.base_of(id).is_some() => {
                    setting.plugin = Box::default();
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
            let base_path = paths::portable(&self.base_path, base_path);
            object.base_path = Some(paths::resolve(&self.base_path, &base_path));
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
        if let Some(lines) = json.get(b"$ignorePatterns") {
            object.ignore_lines = Some(IgnoreLines::of_eslint_8(&strings_of(Some(lines))));
            object.is_global_ignores = true;
        }
        if let Some(message) = validate_object(entries) {
            object.error = Some([&config_name(json)[..], &message].concat());
            return Ok(object);
        }
        for (prefix, name) in json
            .get(b"plugins")
            .and_then(Json::as_object)
            .unwrap_or_default()
        {
            match is_built_in(prefix, name.as_str()) {
                true => {
                    object.plugins.push(prefix[..].into());
                    if let Some(name) = name.as_str() {
                        self.advise_about_version(prefix, name);
                    }
                }
                false => object.foreign_plugins.push(prefix[..].into()),
            }
            if prefix != b"@" {
                object.printed_plugins.push(match name.as_str() {
                    Some(name) => [&prefix[..], b":", name].concat().into(),
                    None => prefix[..].into(),
                });
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
        if let Some(rules) = json.get(b"rules") {
            object.rules = self.rules(rules)?;
        }
        let part = |key: &[u8]| json.get(key).cloned().unwrap_or(Json::Null);
        object.language_options = part(b"languageOptions");
        object.linter_options = part(b"linterOptions");
        object.settings = part(b"settings");
        object.language = json.get(b"language").and_then(Json::as_str).map(Box::from);
        object.processor = json.get(b"processor").and_then(Json::as_str).map(Box::from);
        object.source = json.get(b"$source").cloned();
        object.parser_location = json.get(b"$parser").cloned();
        object.changes_linter = json.get(b"$changesLinter").is_some();
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
            base_path: paths::absolute(base_path),
            prefers_typescript_rules: false,
            objects: Vec::new(),
            notes: Vec::new(),
            advice: Vec::new(),
            unknown_rules: Vec::new(),
            js_plugins: Vec::new(),
            js_locations: Vec::new(),
            defaults: 0,
            foreign_prefixes: Vec::new(),
            has_unknown_resolver: has_unknown_resolver(json, 0),
            handing_back: Vec::new(),
        };
        add_foreign_prefixes(json, 0, &mut reader.foreign_prefixes);
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
        for (prefix, location) in &mut self.js_locations {
            let mut unknown = self.unknown_rules.iter();
            // A rule of `--rulesdir`, which has no prefix, can have the name of a rule that exists here.
            if prefix.is_empty()
                || unknown.any(|id| parse_rule_id(id).0 == &prefix[..])
                || self.handing_back.contains(prefix)
            {
                self.js_plugins.push(load(location, prefix).map_err(|why| {
                    ConfigError::new(&[b"Failed to load the plugin \"", prefix, b"\": ", &why])
                })?);
            }
            // Only where it is is of any more use.
            if let Json::Object(entries) = location {
                entries.retain(|it| it.0 != b"described");
            }
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
            eslint_major: if semantics.is_legacy { 8 } else { 10 },
            lints_all_that_is_named: false,
            dot_patterns: None,
            prefers_typescript_rules: self.prefers_typescript_rules,
            options_of_oxlint: Vec::new(),
            printed_for_oxlint: Vec::new(),
            notes: self.notes,
            advice: self.advice,
            unknown_rules: self.unknown_rules,
            js_plugins: self.js_plugins,
            js_locations: self.js_locations,
            cache: Default::default(),
        }
    }
}
