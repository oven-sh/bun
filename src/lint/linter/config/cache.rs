//! What a [`Config`](super::Config) computes once and all threads share.

use crate::js_plugin::{Configured, Rule};
use crate::language::GlobalsOfOptions;
use crate::linter::resolved::ResolvedConfig;
use crate::options::Json;
use bun_threading::RwLock;
use std::sync::{Arc, OnceLock};

type Resolved = Vec<(Box<[u32]>, Arc<OnceLock<Arc<ResolvedConfig>>>)>;
type JsInstances = Vec<(Arc<[Json]>, Arc<Configured>)>;

pub(super) struct Cache {
    /// By the indices of the objects that are merged. Sorted.
    resolved: RwLock<Resolved>,
    /// What has been made of the rules of JavaScript plugins, by the options as they are written.
    js_rules: RwLock<JsInstances>,
    /// For each rule, by its index in the registry: the options that its schema allows.
    valid: RwLock<Vec<Vec<Arc<[Json]>>>>,
    /// By `$env` and `globals` of `languageOptions`.
    globals: RwLock<Vec<(Option<Json>, Option<Json>, GlobalsOfOptions)>>,
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
        let place = known.unwrap_or_else(|| {
            let mut all = self.resolved.write();
            match find(&all) {
                Ok(at) => Arc::clone(&all[at].1),
                Err(at) => {
                    let place = Arc::default();
                    all.insert(at, (indices.into(), Arc::clone(&place)));
                    place
                }
            }
        });
        // Not under the lock: it takes the other ones. A thread that wants the same waits for it.
        Arc::clone(place.get_or_init(|| Arc::new(make())))
    }

    /// [`GlobalsOfOptions::new`] of `language_options`, which is what `make` does.
    pub(super) fn globals(
        &self,
        language_options: &Json,
        make: impl FnOnce() -> GlobalsOfOptions,
    ) -> GlobalsOfOptions {
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
}
