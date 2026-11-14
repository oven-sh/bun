//! Values that a [`Config`](super::Config) computes once and shares between threads.

use crate::js_plugin::{Configured, Rule};
use crate::language::GlobalsFromOptions;
use crate::linter::resolved::ResolvedConfig;
use crate::options::Json;
use bun_threading::RwLock;
use std::sync::{Arc, OnceLock};

type Resolved = Vec<(Box<[u32]>, Arc<OnceLock<Arc<ResolvedConfig>>>)>;
type JsInstances = Vec<(Arc<[Json]>, Arc<Configured>)>;

pub(super) struct Cache {
    /// Keyed by the indices of the merged objects. Sorted.
    resolved: RwLock<Resolved>,
    /// The configured JavaScript plugin rules, keyed by the options as written.
    js_rules: RwLock<JsInstances>,
    /// Indexed by a rule's index in the registry: the options known to pass its schema.
    valid: RwLock<Vec<Vec<Arc<[Json]>>>>,
    /// Keyed by `$env` and `globals` in `languageOptions`.
    globals: RwLock<Vec<(Option<Json>, Option<Json>, GlobalsFromOptions)>>,
}

impl Default for Cache {
    fn default() -> Self {
        Cache {
            resolved: RwLock::new(Vec::new()),
            js_rules: RwLock::new(Vec::new()),
            valid: RwLock::new(Vec::new()),
            globals: RwLock::new(Vec::new()),
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
        let known = {
            let all = self.resolved.read();
            find(&all).ok().map(|at| Arc::clone(&all[at].1))
        };
        let slot = known.unwrap_or_else(|| {
            let mut all = self.resolved.write();
            match find(&all) {
                Ok(at) => Arc::clone(&all[at].1),
                Err(at) => {
                    let slot = Arc::default();
                    all.insert(at, (indices.into(), Arc::clone(&slot)));
                    slot
                }
            }
        });
        // Not under the lock, because `make` takes the other locks. A thread that wants the same entry waits for it.
        Arc::clone(slot.get_or_init(|| Arc::new(make())))
    }

    /// Returns [`GlobalsFromOptions::new`] for `language_options`, which is what `make` computes.
    pub(super) fn globals(
        &self,
        language_options: &Json,
        make: impl FnOnce() -> GlobalsFromOptions,
    ) -> GlobalsFromOptions {
        let key = (
            language_options.get(b"$env"),
            language_options.get(b"globals"),
        );
        let known = self.globals.read();
        if let Some(found) = known
            .iter()
            .find(|it| (it.0.as_ref(), it.1.as_ref()) == key)
        {
            return found.2.clone();
        }
        drop(known);
        let made = make();
        let entry = (key.0.cloned(), key.1.cloned(), made.clone());
        self.globals.write().push(entry);
        made
    }

    /// True if `options` are [known](Cache::set_valid) to pass the schema of the rule at `index` in the registry.
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
        let matches = |it: &&(Arc<[Json]>, Arc<Configured>)| {
            Arc::ptr_eq(&it.1.rule, rule) && it.0 == *options
        };
        if let Some(found) = rules.iter().find(matches) {
            return Arc::clone(&found.1);
        }
        let made = make();
        rules.push((Arc::clone(options), Arc::clone(&made)));
        made
    }
}
