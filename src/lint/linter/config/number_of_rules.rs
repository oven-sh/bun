//! Counts the rules that an oxlint config turns on.

use super::Config;
use super::merge::RuleSetting;
use crate::context::Severity;
use crate::linter::registry::Registry;
use rustc_hash::FxHashSet;

/// Two settings apply to the same rule if they have the same key. A JavaScript plugin's rule can have the same name as
/// a built-in one: see `merge_rules`.
fn key(it: &RuleSetting) -> (&[u8], bool) {
    (&it.id[..], it.builtin_plugin.is_some())
}

impl Config {
    /// oxlint's `ConfigStore::number_of_rules` for an `.oxlintrc.json`. Counts the rules that are warnings or errors
    /// where no override applies, plus the rules that an override sets to warn or error, whichever files it covers. A
    /// rule that an override turns off still counts. Rules that `categories` turn on for a plugin that only an override
    /// enables don't count. With `with_types`, rules that need types count too.
    ///
    /// A rule that only a category turns on and that Bun doesn't have isn't counted.
    pub fn oxlint_number_of_rules(&self, registry: &Registry, with_types: bool) -> usize {
        let settings = |are_of_overrides: bool| {
            let objects = self.objects.iter();
            objects
                .filter(move |it| it.files.is_some() == are_of_overrides)
                .flat_map(|it| &it.rules)
        };
        let mut on: FxHashSet<(&[u8], bool)> = FxHashSet::default();
        for setting in settings(false) {
            match setting.severity {
                Severity::Off => on.remove(&key(setting)),
                _ => on.insert(key(setting)),
            };
        }
        on.extend(
            settings(true)
                .filter(|it| it.severity != Severity::Off && !it.yields)
                .map(key),
        );
        let needs_types = |id: &[u8]| {
            registry
                .find_preferring(id, true)
                .is_some_and(|it| it.meta.requires_types)
        };
        on.iter()
            .filter(|(id, is_built_in)| with_types || !(*is_built_in && needs_types(id)))
            .count()
    }
}
