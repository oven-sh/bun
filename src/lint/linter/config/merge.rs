//! How ESLint merges two configuration objects: `flat-config-schema.js`.

use crate::context::Severity;
use crate::linter::resolved::severity_of;
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

/// `deep_merge` of two values of which either can be missing.
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

/// An entry of `rules`, normalized: the severity, and what follows it.
#[derive(Clone, Debug)]
pub(crate) struct RuleSetting {
    pub(crate) id: Box<[u8]>,
    /// The plugin that ESLint takes the rule from, as it is written. Empty for a rule of ESLint
    /// itself, and for the names that only oxlint has.
    pub(crate) plugin: Box<[u8]>,
    /// The plugin that the name as it is written is of, by any of its names, if it is one that is implemented here. Not for
    /// a rule of a JavaScript plugin.
    pub(crate) written_for: Option<Plugin>,
    pub(crate) severity: Severity,
    pub(crate) options: Vec<Json>,
    /// It has no options of its own, so it keeps those of the setting that it overrides.
    pub(crate) has_only_severity: bool,
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
            written_for: None,
            severity: severity_of(value.first()?)?,
            options: value[1..].to_vec(),
            has_only_severity: value.len() == 1,
        })
    }
}

/// The `merge` of `rulesSchema`. `keeps_options`: a setting that is only a severity keeps the
/// options of the one before it, as in ESLint. In oxlint it resets them.
pub(crate) fn merge_rules(
    first: &mut Vec<RuleSetting>,
    second: &[RuleSetting],
    keeps_options: bool,
) {
    for setting in second {
        match first.iter_mut().find(|it| it.id == setting.id) {
            Some(existing) if setting.has_only_severity && keeps_options => {
                existing.severity = setting.severity
            }
            Some(existing) => existing.clone_from(setting),
            None => first.push(setting.clone()),
        }
    }
}
