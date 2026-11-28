//! <https://github.com/nodejs/node/blob/v26.12.1/lib/internal/fs/glob.js#L1280-L1311>

use std::rc::Rc;

use bun_collections::hashbrown::HashTable;
use bun_core::strings::CodeUnits;

use super::{Abort, Error, Minimatch, Options};

const MAX_ENTRIES: usize = 1024;
const MAX_BYTES: usize = 64 << 20;

struct Entry {
    hash: u64,
    pattern_bytes: Box<[u8]>,
    is_16bit: bool,
    options: Options,
    /// `None` if compiling exceeds the budget.
    matcher: Option<Minimatch>,
    memory_cost: usize,
}

impl Entry {
    #[inline(always)]
    fn is_for(&self, pattern: CodeUnits<'_>, options: Options) -> bool {
        self.options == options
            && self.is_16bit == pattern.is_16bit()
            && crate::scan::eql(&self.pattern_bytes, pattern.as_bytes())
    }
}

#[derive(Default)]
pub struct Cache {
    /// May exceed [`MAX_BYTES`], so that a loop over paths compiles a large pattern once.
    last_used: Option<Rc<Entry>>,
    table: HashTable<Rc<Entry>>,
    entries: Vec<Rc<Entry>>,
    memory_cost: usize,
}

impl Cache {
    /// `matchesGlob(path, pattern)`. Long computations poll `should_continue`.
    #[inline(always)]
    pub fn matches(
        &mut self,
        path: CodeUnits<'_>,
        pattern: CodeUnits<'_>,
        options: Options,
        should_continue: &mut dyn FnMut() -> bool,
    ) -> Result<bool, Error> {
        let entry = match &self.last_used {
            Some(last_used) if last_used.is_for(pattern, options) => last_used,
            _ => self.lookup_or_compile(pattern, options, should_continue)?,
        };
        let matcher = entry.matcher.as_ref().ok_or(Abort::BudgetExceeded)?;
        Ok(matcher.matches(path, should_continue)?)
    }

    #[inline(never)]
    fn lookup_or_compile(
        &mut self,
        pattern: CodeUnits<'_>,
        options: Options,
        should_continue: &mut dyn FnMut() -> bool,
    ) -> Result<&Entry, Error> {
        let pattern_bytes = pattern.as_bytes();
        let hash = bun_wyhash::hash(pattern_bytes);
        if let Some(entry) = self.table.find(hash, |it| it.is_for(pattern, options)) {
            return Ok(self.last_used.insert(Rc::clone(entry)));
        }
        let matcher = match Minimatch::compile(pattern, options, should_continue) {
            Err(Error::Aborted(Abort::BudgetExceeded)) => None,
            compiled => Some(compiled?),
        };
        let entry = Rc::new(Entry {
            hash,
            pattern_bytes: pattern_bytes.into(),
            is_16bit: pattern.is_16bit(),
            options,
            memory_cost: size_of::<Entry>()
                + pattern_bytes.len()
                + matcher.as_ref().map_or(0, Minimatch::memory_cost),
            matcher,
        });
        if entry.memory_cost <= MAX_BYTES {
            self.insert(&entry);
        }
        Ok(self.last_used.insert(entry))
    }

    fn insert(&mut self, entry: &Rc<Entry>) {
        self.memory_cost += entry.memory_cost;
        // Evicting the oldest would miss on every call of a loop over more patterns than fit.
        while (self.entries.len() == MAX_ENTRIES || self.memory_cost > MAX_BYTES)
            && let Some(arbitrary) = (entry.hash as usize).checked_rem(self.entries.len())
        {
            let evicted = self.entries.swap_remove(arbitrary);
            self.memory_cost -= evicted.memory_cost;
            if let Ok(found) = (self.table).find_entry(evicted.hash, |it| Rc::ptr_eq(it, &evicted))
            {
                found.remove();
            }
        }
        self.entries.push(Rc::clone(entry));
        (self.table).insert_unique(entry.hash, Rc::clone(entry), |it| it.hash);
    }
}
