//! What a [`Config`](super::Config) computes once and all threads share.

use crate::linter::registry::Registry;
use crate::linter::resolved::ResolvedConfig;
use crate::options::Json;
use crate::runner::{AnyRule, RuleEntry};
use bun_threading::RwLock;
use std::sync::Arc;

type Resolved = Vec<(Box<[u32]>, Arc<ResolvedConfig>)>;
type Instances = Vec<(Arc<[Json]>, Arc<dyn AnyRule>)>;

pub(super) struct Cache {
    /// By the indices of the objects that are merged. Sorted.
    resolved: RwLock<Resolved>,
    /// For each rule, by its index in the registry: what has been made of it, by the options.
    rules: RwLock<Vec<Instances>>,
}

impl Default for Cache {
    fn default() -> Self {
        Cache {
            resolved: RwLock::new(Vec::new()),
            rules: RwLock::new(Vec::new()),
        }
    }
}

impl Cache {
    pub(super) fn resolved(&self, indices: &[u32], make: impl FnOnce() -> ResolvedConfig) -> Arc<ResolvedConfig> {
        let find = |all: &Resolved| all.binary_search_by(|it| (*it.0).cmp(indices));
        {
            let all = self.resolved.read();
            if let Ok(at) = find(&all) {
                return Arc::clone(&all[at].1);
            }
        }
        // Not under the lock: it takes the other one. Two threads may do the same work once.
        let made = Arc::new(make());
        let mut all = self.resolved.write();
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
        let mut rules = self.rules.write();
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
