//! A bounded cache of shared objects by locale name, one per type. ICU4C: unifiedcache.cpp

use crate::common::locid::name_as_key;
use crate::common::memory::{
    Appendable, best_effort, fail_on_oom, try_shared_result, try_to_vec, try_with_capacity,
};
use crate::common::sorting::sort_in_place;
use crate::common::umutex::StaticMap;
use crate::common::utypes::*;
use std::any::Any;
use std::marker::PhantomData;
use std::sync::Arc;
use std::sync::atomic::{AtomicIsize, AtomicU8, AtomicU32, Ordering::Relaxed};

/// `DEFAULT_MAX_UNUSED`
pub(crate) const MAX_UNUSED: usize = 1000;

type CacheResult<T> = Result<Arc<T>, UErrorCode>;
type AnyResult = CacheResult<dyn Any + Send + Sync>;

fn is_unique<T: ?Sized>(result: &CacheResult<T>) -> bool {
    result
        .as_ref()
        .is_ok_and(|object| Arc::strong_count(object) == 1)
}

#[derive(Clone)]
struct Entry {
    result: AnyResult,
    /// Whether this is the first name under which the object was cached.
    is_primary: bool,
    /// The number of earlier insertions. It orders the entries for eviction: chosen names can have equal hashes.
    serial: u32,
}

impl Entry {
    fn is_evictable(&self) -> bool {
        !self.is_primary || is_unique(&self.result)
    }

    fn is_alias(&self) -> bool {
        !self.is_primary && self.result.is_ok()
    }
}

/// The part of `LocaleCache` that does not depend on `T`, so that it is compiled once.
struct Entries {
    table: StaticMap<Vec<u8>, Entry>,
    uses_until_sweep: AtomicIsize,
    inserts: AtomicU32,
    sweeps: AtomicU8,
}

impl Entries {
    fn get(&self, name: &[u8], limit: usize) -> Option<AnyResult> {
        let (result, len) = self
            .table
            .with_lock(|table| Some((table.get(name_as_key(name))?.result.clone(), table.len())))?;
        // Only objects that are or were shared make the table so large.
        if len > limit + limit / 4 {
            self.count_use(limit);
        }
        Some(result)
    }

    /// Returns whether `result` is an object that no entry has. The root collator is shared before it is cached.
    fn is_new(&self, result: &AnyResult) -> bool {
        let Ok(new) = result else { return false };
        let has_it = |entry: &Entry| entry.result.as_ref().is_ok_and(|old| Arc::ptr_eq(old, new));
        !self.table.with_lock(|table| table.values().any(has_it))
    }

    #[cfg_attr(mordant, allow(error_collapsed_to_bool))] // A later use sweeps again.
    fn count_use(&self, limit: usize) {
        if self.uses_until_sweep.fetch_sub(1, Relaxed) <= 0 {
            let _ = best_effort(|| self.sweep(limit));
        }
    }

    fn sweep(&self, limit: usize) -> Result<(), UErrorCode> {
        loop {
            let counts = self.table.with_lock(|table| {
                let count = |is_counted: fn(&Entry) -> bool| {
                    table.values().filter(|entry| is_counted(entry)).count()
                };
                (
                    table.len(),
                    count(Entry::is_evictable),
                    count(Entry::is_alias),
                )
            });
            let (len, evictable, aliases) = counts;
            // An object that only aliases share is not in use. Each such object has an alias of its own.
            let max_unused = limit.max((len - evictable).saturating_sub(aliases));
            self.uses_until_sweep
                .store((max_unused / 8) as isize, Relaxed);
            if evictable <= max_unused {
                return Ok(());
            }
            self.evict_an_eighth(evictable)?;
        }
    }

    /// By eighths, so that cycling through slightly too many names still mostly hits.
    fn evict_an_eighth(&self, evictable: usize) -> Result<(), UErrorCode> {
        let (mut order, mut evicted) = (
            try_with_capacity(evictable)?,
            try_with_capacity(evictable / 8 + 1)?,
        );
        self.table.with_lock(|table| {
            let entries = table
                .values()
                .filter(|entry| entry.is_evictable())
                .take(evictable);
            order.add_each(entries.map(|entry| entry.serial));
        });
        sort_in_place(&mut order);
        // Each eviction starts at a different offset.
        let offset = usize::from(self.sweeps.fetch_add(1, Relaxed)) + 1;
        self.table.drain_matching(&mut evicted, |_, entry| {
            entry.is_evictable()
                && order
                    .binary_search(&entry.serial)
                    .is_ok_and(|rank| (offset + rank) % 8 == 0)
        });
        Ok(())
    }

    /// Returns the cached entry, which another thread may have inserted first, or `None` if allocation fails.
    fn insert(&'static self, name: &[u8], entry: Entry, limit: usize) -> Option<AnyResult> {
        let cached = best_effort(|| {
            self.table
                .get_or_insert_with(try_to_vec(name_as_key(name))?, || entry)
        })?;
        self.count_use(limit);
        Some(cached.result)
    }
}

/// Evicts when evictable entries outnumber both `LIMIT` and the entries in use. The key must contain every input of the object.
pub(crate) struct LocaleCache<T, const LIMIT: usize = MAX_UNUSED>(Entries, PhantomData<T>);

impl<T: Send + Sync + 'static, const LIMIT: usize> LocaleCache<T, LIMIT> {
    pub(crate) const fn new() -> Self {
        let (inserts, sweeps) = (AtomicU32::new(0), AtomicU8::new(0));
        Self(
            Entries {
                table: StaticMap::new(),
                uses_until_sweep: AtomicIsize::new(0),
                inserts,
                sweeps,
            },
            PhantomData,
        )
    }

    fn downcast(result: AnyResult) -> Option<CacheResult<T>> {
        match result {
            Ok(object) => object.downcast().ok().map(Ok),
            Err(code) => Some(Err(code)),
        }
    }

    #[inline]
    pub(crate) fn get(&self, name: &[u8]) -> Option<CacheResult<T>> {
        self.0.get(name, LIMIT).and_then(Self::downcast)
    }

    /// Caches failures too.
    pub(crate) fn get_or_insert_with(
        &'static self,
        name: &[u8],
        create: impl FnOnce() -> CacheResult<T>,
    ) -> CacheResult<T> {
        self.get(name)
            .unwrap_or_else(|| self.insert(name, fail_on_oom(create)))
    }

    /// `get_or_insert_with` for a `create` that always returns a new object.
    pub(crate) fn get_or_create(
        &'static self,
        name: &[u8],
        create: impl FnOnce() -> Result<T, UErrorCode>,
    ) -> CacheResult<T> {
        self.get_or_insert_with(name, || try_shared_result(&mut create()))
    }

    /// Caches no failure.
    pub(crate) fn get_or_try_insert_with(
        &'static self,
        name: &[u8],
        create: impl FnOnce() -> CacheResult<T>,
    ) -> CacheResult<T> {
        self.get(name)
            .unwrap_or_else(|| self.insert(name, Ok(create()?)))
    }

    #[inline(never)]
    fn insert(&'static self, name: &[u8], result: CacheResult<T>) -> CacheResult<T> {
        let is_unique = is_unique(&result);
        let any = result
            .clone()
            .map(|object| object as Arc<dyn Any + Send + Sync>);
        let is_primary = is_unique || self.0.is_new(&any);
        let entry = Entry {
            result: any,
            is_primary,
            serial: self.0.inserts.fetch_add(1, Relaxed),
        };
        self.0
            .insert(name, entry, LIMIT)
            .and_then(Self::downcast)
            .unwrap_or(result)
    }
}
