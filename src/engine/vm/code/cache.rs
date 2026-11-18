//! Code of scripts, modules, indirect `eval` and the `Function` constructor, by the text that it was made from.

use core::time::Duration;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Instant;

use bun_engine_bytecode::{
    Directives, Eval, FunctionRef, Instrumentation, Module, Script, StaticScope,
};
use bun_engine_text::StringRef;
use hashbrown::HashTable;

use super::source::Lines;
use crate::SourceProvider;

#[derive(Clone)]
pub(super) enum Unit {
    Script(Rc<Script>),
    Module(Rc<Module>),
    Eval(Rc<Eval>),
    Function(FunctionRef, Rc<Directives>),
}

impl Unit {
    pub(super) fn directives(&self) -> &Directives {
        match self {
            Unit::Script(script) => &script.directives,
            Unit::Module(module) => &module.directives,
            Unit::Eval(eval) => &eval.directives,
            Unit::Function(_, directives) => directives,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Goal {
    Script,
    Module,
    /// Its imports and exports may be missing.
    AnalyzedModule,
    Eval,
    Function {
        parameters_end: Option<u32>,
    },
}

/// All that the code depends on.
#[derive(Clone, Copy)]
pub(super) struct Key<'a> {
    pub(super) provider: &'a SourceProvider,
    pub(super) goal: Goal,
    pub(super) instrumentation: Instrumentation,
    pub(super) outer: Option<&'a Rc<StaticScope>>,
}

struct Entry {
    source: StringRef,
    hash: u32,
    goal: Goal,
    instrumentation: Instrumentation,
    outer: Option<Rc<StaticScope>>,
    unit: Unit,
    lines: Option<Arc<Lines>>,
    last_use: u64,
    /// In this period.
    was_wanted_again: bool,
}

fn spread(hash: u32) -> u64 {
    u64::from(hash).wrapping_mul(0x9e37_79b9_7f4a_7c15)
}

/// What is remembered of an entry that has made room.
fn trace_of(hash: u32, outer: Option<&Rc<StaticScope>>) -> u32 {
    hash ^ outer.map_or(0, |it| (spread(Rc::as_ptr(it).addr() as u32) >> 32) as u32)
}

impl Entry {
    fn matches(&self, key: &Key<'_>) -> bool {
        self.hash == key.provider.hash()
            && self.goal == key.goal
            && self.instrumentation == key.instrumentation
            && self.outer.as_ref().map(Rc::as_ptr) == key.outer.map(Rc::as_ptr)
            && self.source == *key.provider.source()
    }
}

pub(super) struct CodeCache {
    entries: HashTable<Entry>,
    max_entries: usize,
    /// In code units of source.
    size: usize,
    /// Beyond the limits, for what has been asked for again after it had to make room.
    extra_entries: usize,
    extra_size: usize,
    /// Traces of what has made room in this period, each in the place that its low bits say.
    displaced: Vec<u32>,
    uses: u64,
    period_start: Instant,
    uses_at_period_start: u64,
}

impl Default for CodeCache {
    fn default() -> CodeCache {
        CodeCache {
            entries: HashTable::new(),
            max_entries: Self::DEFAULT_MAX_ENTRIES,
            size: 0,
            extra_entries: 0,
            extra_size: 0,
            displaced: Vec::new(),
            uses: 0,
            period_start: Instant::now(),
            uses_at_period_start: 0,
        }
    }
}

impl CodeCache {
    const DEFAULT_MAX_ENTRIES: usize = 2000;
    pub(super) const MAX_SIZE: usize = 16_000_000;
    const MAX_GROWN_ENTRIES: usize = 1 << 14;
    const MAX_EXTRA_SIZE: usize = 7 * Self::MAX_SIZE;
    const DISPLACED_PLACES: usize = 1 << 12;
    /// What is not used in the whole of one goes.
    const PERIOD: Duration = Duration::from_secs(10);

    pub(super) fn find(&mut self, key: &Key<'_>) -> Option<Unit> {
        let hash = spread(key.provider.hash());
        let entry = self.entries.find_mut(hash, |entry| entry.matches(key))?;
        self.uses += 1;
        (entry.last_use, entry.was_wanted_again) = (self.uses, true);
        key.provider.share_lines(entry.lines.clone());
        Some(entry.unit.clone())
    }

    /// `find` has found nothing.
    pub(super) fn add(&mut self, key: &Key<'_>, unit: Unit) {
        let (hash, length) = (key.provider.hash(), key.provider.source().len());
        let trace = trace_of(hash, key.outer);
        let place = (self.displaced).get_mut(trace as usize % Self::DISPLACED_PLACES);
        let is_back = place
            .filter(|it| **it == trace)
            .map(core::mem::take)
            .is_some();
        if is_back {
            let most = Self::MAX_GROWN_ENTRIES.saturating_sub(self.max_entries);
            self.extra_entries = (self.extra_entries + 1).min(most);
            self.extra_size = (self.extra_size + length).min(Self::MAX_EXTRA_SIZE);
        }
        self.prune();
        self.uses += 1;
        self.size += length;
        let entry = Entry {
            source: key.provider.source().clone(),
            hash,
            goal: key.goal,
            instrumentation: key.instrumentation,
            outer: key.outer.cloned(),
            unit,
            lines: key.provider.shared_lines(),
            last_use: self.uses,
            was_wanted_again: is_back,
        };
        (self.entries).insert_unique(spread(entry.hash), entry, |entry| spread(entry.hash));
    }

    pub(super) fn clear(&mut self) {
        *self = CodeCache {
            max_entries: self.max_entries,
            ..CodeCache::default()
        };
    }

    pub(super) fn max_entries(&self) -> usize {
        self.max_entries
    }

    pub(super) fn set_max_entries(&mut self, count: usize) {
        self.max_entries = count.max(Self::DEFAULT_MAX_ENTRIES);
    }

    pub(super) fn prune(&mut self) {
        if self.period_start.elapsed() >= Self::PERIOD {
            self.displaced = Vec::new();
            self.remove_unused_since(self.uses_at_period_start);
            let wanted = (self.entries.iter_mut()).filter_map(|it| {
                core::mem::take(&mut it.was_wanted_again).then(|| it.source.len())
            });
            let (count, size) = wanted.fold((0, 0), |sum, it| (sum.0 + 1, sum.1 + it));
            self.extra_entries = self.extra_entries.min(count);
            self.extra_size = self.extra_size.min(size);
            self.period_start = Instant::now();
            self.uses_at_period_start = self.uses;
        }
        while self.entries.len() >= self.max_entries + self.extra_entries
            || self.size > Self::MAX_SIZE + self.extra_size
        {
            let mut uses: Vec<u64> = self.entries.iter().map(|entry| entry.last_use).collect();
            let oldest_eighth = uses.len() / 8;
            self.displaced.resize(Self::DISPLACED_PLACES, 0);
            self.remove_unused_since(*uses.select_nth_unstable(oldest_eighth).1);
        }
    }

    fn remove_unused_since(&mut self, last_use: u64) {
        self.entries.retain(|entry| {
            if entry.last_use <= last_use {
                self.size -= entry.source.len();
                let trace = trace_of(entry.hash, entry.outer.as_ref());
                let place = trace as usize % Self::DISPLACED_PLACES;
                if let Some(place) = self.displaced.get_mut(place) {
                    *place = trace;
                }
            }
            entry.last_use > last_use
        });
    }
}
