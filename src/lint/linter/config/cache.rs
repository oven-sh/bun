//! What a [`Config`](super::Config) computes once and all threads share.

use crate::linter::registry::Registry;
use crate::linter::resolved::ResolvedConfig;
use crate::options::Json;
use crate::runner::{AnyRule, RuleEntry};
use std::sync::{Arc, RwLock};

type Instances = Vec<(Arc<[Json]>, Arc<dyn AnyRule>)>;

#[derive(Default)]
pub(super) struct Cache {
    /// By the indices of the objects that are merged. Sorted.
    resolved: RwLock<Vec<(Box<[u32]>, Arc<ResolvedConfig>)>>,
    /// For each rule, by its index in the registry: what has been made of it, by the options.
    rules: RwLock<Vec<Instances>>,
}

impl Cache {
    pub(super) fn resolved(&self, indices: &[u32], make: impl FnOnce() -> ResolvedConfig) -> Arc<ResolvedConfig> {
        let find = |all: &[(Box<[u32]>, Arc<ResolvedConfig>)]| all.binary_search_by(|it| (*it.0).cmp(indices));
        if let Ok(all) = self.resolved.read()
            && let Ok(at) = find(&all)
        {
            return Arc::clone(&all[at].1);
        }
        // Not under the lock: it takes the other one. Two threads may do the same work once.
        let made = Arc::new(make());
        let Ok(mut all) = self.resolved.write() else {
            return made;
        };
        match find(&all) {
            Ok(at) => Arc::clone(&all[at].1),
            Err(at) => {
                all.insert(at, (indices.into(), Arc::clone(&made)));
                made
            }
        }
    }

    pub(super) fn rule(
        &self,
        registry: &Registry,
        entry: &'static RuleEntry,
        options: &Arc<[Json]>,
        make: impl FnOnce() -> Arc<dyn AnyRule>,
    ) -> Arc<dyn AnyRule> {
        let Some(index) = registry.index_of(entry) else {
            return make();
        };
        let Ok(mut rules) = self.rules.write() else {
            return make();
        };
        if rules.len() <= index {
            rules.resize_with(index + 1, Vec::new);
        }
        if let Some(found) = rules[index].iter().find(|it| it.0 == *options) {
            return Arc::clone(&found.1);
        }
        let made = make();
        rules[index].push((Arc::clone(options), Arc::clone(&made)));
        made
    }
}
