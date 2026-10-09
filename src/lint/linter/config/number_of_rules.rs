//! How many rules a configuration of oxlint has on.

use super::Config;
use crate::context::Severity;
use crate::linter::registry::Registry;
use rustc_hash::FxHashSet;

impl Config {
    /// oxlint's `ConfigStore::number_of_rules`, of an `.oxlintrc.json`: the rules that warn or are errors where no override
    /// applies, and those that an override makes warn or an error, whichever files it is for. What an override turns off still
    /// counts. `with_types`: the rules that need types count too.
    ///
    /// A rule that only a category turns on and that does not exist here is not counted.
    pub fn number_of_rules_of_oxlint(&self, registry: &Registry, with_types: bool) -> usize {
        let settings = |are_of_overrides: bool| {
            let objects = self.objects.iter();
            objects
                .filter(move |it| it.files.is_some() == are_of_overrides)
                .flat_map(|it| &it.rules)
        };
        let mut on: FxHashSet<&[u8]> = FxHashSet::default();
        for setting in settings(false) {
            match setting.severity {
                Severity::Off => on.remove(&setting.id[..]),
                _ => on.insert(&setting.id[..]),
            };
        }
        on.extend(
            settings(true)
                .filter(|it| it.severity != Severity::Off)
                .map(|it| &it.id[..]),
        );
        let needs_types = |id: &[u8]| {
            registry
                .find_preferring(id, true)
                .is_some_and(|it| it.meta.requires_types)
        };
        on.iter()
            .filter(|id| with_types || !needs_types(id))
            .count()
    }
}
