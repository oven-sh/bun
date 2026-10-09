//! What a [`Config`](super::Config) computes once and all threads share.

use crate::js_plugin::{Configured, Rule};
use crate::linter::registry::Registry;
use crate::linter::resolved::ResolvedConfig;
use crate::options::Json;
use crate::runner::{AnyRule, RuleEntry};
use bun_threading::RwLock;
use std::sync::Arc;

type Resolved = Vec<(Box<[u32]>, Arc<ResolvedConfig>)>;
type Instances = Vec<(Arc<[Json]>, Arc<dyn AnyRule>)>;
type JsInstances = Vec<(Arc<[Json]>, Arc<Configured>)>;

pub(super) struct Cache {
    /// By the indices of the objects that are merged. Sorted.
    resolved: RwLock<Resolved>,
    /// For each rule, by its index in the registry: what has been made of it, by the options.
    rules: RwLock<Vec<Instances>>,
    /// The same for the rules of JavaScript plugins, by the options as they are written.
    js_rules: RwLock<JsInstances>,
    /// For each rule, by its index in the registry: the options that its schema allows.
    valid: RwLock<Vec<Vec<Arc<[Json]>>>>,
}

impl Default for Cache {
    fn default() -> Self {
        Cache {
            resolved: RwLock::new(Vec::new()),
            rules: RwLock::new(Vec::new()),
            js_rules: RwLock::new(Vec::new()),
            valid: RwLock::new(Vec::new()),
        }
    }
}

impl Cache {
    pub(super) fn resolved(
        &self,
        indices: &[u32],
        make: impl FnOnce() -> ResolvedConfig,
    ) -> Arc<ResolvedConfig> {
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

    /// Whether `options` are [known](Cache::set_valid) to be what the schema of the rule at `index` of the registry allows.
    pub(super) fn is_valid(&self, index: usize, options: &Arc<[Json]>) -> bool {
        let valid = self.valid.read();
        (valid.get(index)).is_some_and(|all| all.iter().any(|it| it == options))
    }

    pub(super) fn set_valid(&self, index: usize, options: &Arc<[Json]>) {
        let mut valid = self.valid.write();
        if valid.len() <= index {
            valid.resize_with(index + 1, Vec::new);
        }
        valid[index].push(Arc::clone(options));
    }

    pub(super) fn js_rule(
        &self,
        rule: &Arc<Rule>,
        options: &Arc<[Json]>,
        make: impl FnOnce() -> Arc<Configured>,
    ) -> Arc<Configured> {
        let mut rules = self.js_rules.write();
        let is_it = |it: &&(Arc<[Json]>, Arc<Configured>)| {
            Arc::ptr_eq(&it.1.rule, rule) && it.0 == *options
        };
        if let Some(found) = rules.iter().find(is_it) {
            return Arc::clone(&found.1);
        }
        let made = make();
        rules.push((Arc::clone(options), Arc::clone(&made)));
        made
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
