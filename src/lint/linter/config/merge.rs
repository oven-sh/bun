//! How ESLint merges two config objects: `flat-config-schema.js`.

use crate::context::Severity;
use crate::linter::resolved::severity_of;
use crate::linter::schema::deep_merge_arrays;
use crate::options::Json;
use crate::rule::Plugin;

type Entries = Vec<(Vec<u8>, Json)>;

/// `deepMerge(first, second)`: objects are merged, anything else is replaced.
pub(crate) fn deep_merge(first: &mut Entries, second: &[(Vec<u8>, Json)]) {
    for (key, value) in second {
        if key == b"__proto__" {
            continue;
        }
        match first.iter_mut().find(|it| it.0 == *key) {
            Some((_, Json::Object(existing))) if matches!(value, Json::Object(_)) => {
                deep_merge(existing, value.as_object().unwrap_or_default());
            }
            Some(existing) => existing.1.clone_from(value),
            None => first.push((key.clone(), value.clone())),
        }
    }
}

/// `deep_merge` for two values, either of which can be missing.
pub(crate) fn deep_merge_into(first: &mut Json, second: &Json) {
    let Json::Object(second) = second else {
        return;
    };
    if !matches!(first, Json::Object(_)) {
        *first = Json::Object(Vec::new());
    }
    if let Json::Object(first) = first {
        deep_merge(first, second);
    }
}

/// A normalized `rules` entry: the severity and the options after it.
#[derive(Clone, Debug)]
pub(crate) struct RuleSetting {
    pub(crate) id: Box<[u8]>,
    /// The plugin that ESLint takes the rule from, as written. Empty for ESLint's own rules and for names that only
    /// oxlint has.
    pub(crate) plugin: Box<[u8]>,
    /// The built-in plugin that the written name belongs to, under any of the plugin's aliases. `None` for a JavaScript
    /// plugin's rule.
    pub(crate) builtin_plugin: Option<Plugin>,
    pub(crate) severity: Severity,
    pub(crate) options: Vec<Json>,
    /// It has no options, so it keeps those of the setting it overrides.
    pub(crate) has_only_severity: bool,
    /// It's ignored if an earlier setting already covers the rule.
    pub(crate) yields: bool,
    /// The rule's default options with no config file: `$defaultOptions` in `bun lint`'s default config. Options from a later
    /// setting are merged over them, the way ESLint merges options over a rule's `meta.defaultOptions`. Empty with a config file.
    pub(crate) defaults: Vec<Json>,
}

impl RuleSetting {
    /// `None` if the severity is invalid.
    pub(crate) fn new(id: &[u8], value: &Json) -> Option<RuleSetting> {
        let value: &[Json] = match value {
            Json::Array(items) => items,
            value => std::slice::from_ref(value),
        };
        Some(RuleSetting {
            id: id.into(),
            plugin: Box::default(),
            builtin_plugin: None,
            severity: severity_of(value.first()?)?,
            options: value[1..].to_vec(),
            has_only_severity: value.len() == 1,
            yields: false,
            defaults: Vec::new(),
        })
    }
}

/// `rulesSchema`'s `merge`. With `keeps_options`, a setting that's only a severity keeps the previous setting's
/// options, as in ESLint. In oxlint it resets them.
pub(crate) fn merge_rules(
    first: &mut Vec<RuleSetting>,
    second: &[RuleSetting],
    keeps_options: bool,
) {
    for setting in second {
        // A JavaScript plugin's rule and a built-in rule can share a name: `n/..` with oxlint, which calls the built-in
        // one `node/..`.
        let is_same = |it: &&mut RuleSetting| {
            it.id == setting.id && it.builtin_plugin.is_some() == setting.builtin_plugin.is_some()
        };
        match first.iter_mut().find(is_same) {
            Some(_) if setting.yields => {}
            Some(existing) if setting.has_only_severity && keeps_options => {
                existing.severity = setting.severity
            }
            Some(existing) if existing.defaults.is_empty() => existing.clone_from(setting),
            Some(existing) => {
                let defaults = std::mem::take(&mut existing.defaults);
                existing.clone_from(setting);
                existing.options = deep_merge_arrays(&defaults, &setting.options);
                existing.defaults = defaults;
            }
            None => first.push(setting.clone()),
        }
    }
}
