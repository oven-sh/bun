//! The rules as they are made from options: one for each rule and each list of options, for the whole run.
//!
//! A configuration names one by its number. So neither it nor what carries it around has to know the type of the rules: only the
//! [`Linter`](super::Linter) does, which has the table, and makes a rule the first time that it lints with it.

use crate::options::Json;
use bun_threading::Guarded;
use std::sync::{Arc, OnceLock};

/// A place in the table of a linter.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct Instance(u32);

/// How many places the first chunk has. Each of the others has twice as many as the one before it.
const FIRST: u32 = 64;

pub(super) struct Instances<R> {
    /// Nothing in it ever moves, so it is read while another thread adds to it.
    chunks: [OnceLock<Box<[OnceLock<R>]>>; 26],
    made: Guarded<Made>,
}

#[derive(Default)]
struct Made {
    /// For each rule, by its index in the registry: what has been made of it, by the options.
    by_rule: Vec<Vec<(Arc<[Json]>, Instance)>>,
    len: u32,
}

/// The chunk that has the place `at`, and where it is in it.
fn place(at: u32) -> (usize, usize) {
    let chunk = (at / FIRST + 1).ilog2();
    (chunk as usize, (at - FIRST * ((1 << chunk) - 1)) as usize)
}

impl<R> Instances<R> {
    pub(super) fn new() -> Instances<R> {
        Instances {
            chunks: std::array::from_fn(|_| OnceLock::new()),
            made: Guarded::new(Made::default()),
        }
    }

    pub(super) fn get(&self, it: Instance) -> Option<&R> {
        let (chunk, at) = place(it.0);
        self.chunks.get(chunk)?.get()?.get(at)?.get()
    }

    /// The one for the rule at `index` of the registry and `options`. `make` makes it if there is none yet. `None`: it makes none.
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
        let (chunk, at) = place(it.0);
        let places = self.chunks[chunk]
            .get_or_init(|| (0..FIRST << chunk).map(|_| OnceLock::new()).collect());
        // Nobody else has this place.
        let _ = places[at].set(rule);
        made.len += 1;
        made.by_rule[index].push((Arc::clone(options), it));
        Some(it)
    }
}
