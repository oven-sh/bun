//! Rule instances built from options: one per rule and option list, for the whole run.
//!
//! A config refers to an instance by number. So neither the config nor the code that passes it around has to know the
//! rules' type. Only the [`Linter`](super::Linter) does: it owns the table and builds a rule the first time it lints
//! with it.

use crate::options::Json;
use bun_threading::Guarded;
use std::sync::{Arc, OnceLock};

/// A slot in a linter's table.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct Instance(u32);

/// The number of slots in the first chunk. Each later chunk has twice as many as the one before.
const FIRST: u32 = 64;

pub(super) struct Instances<R> {
    /// Nothing in it ever moves, so it can be read while another thread adds to it.
    chunks: [OnceLock<Box<[OnceLock<R>]>>; 26],
    made: Guarded<InstanceIndex>,
}

#[derive(Default)]
struct InstanceIndex {
    /// Indexed by a rule's index in the registry: the rule's instances so far, with their options.
    by_rule: Vec<Vec<(Arc<[Json]>, Instance)>>,
    len: u32,
}

/// An [`Instance`]'s location.
struct Slot {
    chunk: usize,
    /// The index within the chunk.
    at: usize,
}

impl Instance {
    fn slot(self) -> Slot {
        let chunk = (self.0 / FIRST + 1).ilog2();
        Slot {
            chunk: chunk as usize,
            at: (self.0 - FIRST * ((1 << chunk) - 1)) as usize,
        }
    }
}

impl<R> Instances<R> {
    pub(super) fn new() -> Instances<R> {
        Instances {
            chunks: std::array::from_fn(|_| OnceLock::new()),
            made: Guarded::new(InstanceIndex::default()),
        }
    }

    pub(super) fn get(&self, it: Instance) -> Option<&R> {
        let Slot { chunk, at } = it.slot();
        self.chunks.get(chunk)?.get()?.get(at)?.get()
    }

    /// Returns the instance for the rule at `index` in the registry with `options`. `make` builds it if it doesn't
    /// exist yet. Returns `None` if `make` does.
    pub(super) fn of(
        &self,
        index: usize,
        options: &Arc<[Json]>,
        make: impl FnOnce() -> Option<R>,
    ) -> Option<Instance> {
        let mut made = self.made.lock();
        if made.by_rule.len() <= index {
            made.by_rule.resize_with(index + 1, Vec::new);
        }
        if let Some(found) = made.by_rule[index].iter().find(|it| it.0 == *options) {
            return Some(found.1);
        }
        let rule = make()?;
        let it = Instance(made.len);
        let Slot { chunk, at } = it.slot();
        let slots = self.chunks[chunk]
            .get_or_init(|| (0..FIRST << chunk).map(|_| OnceLock::new()).collect());
        // No other thread has this slot.
        let _ = slots[at].set(rule);
        made.len += 1;
        made.by_rule[index].push((Arc::clone(options), it));
        Some(it)
    }
}
