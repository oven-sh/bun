use bun_collections::StringHashMap;
use bun_core::UnwrapOrOom as _;
use bun_ptr::{AnyRefCounted, CellRefCounted, RefPtr};

/// By query text. A text has one statement for each set of parameter types it ran with.
pub(crate) struct StatementCache<S: AnyRefCounted> {
    /// Each with the `clock` of its last use.
    statements: StringHashMap<Vec<(RefPtr<S>, u64)>>,
    len: usize,
    clock: u64,
}

impl<S: AnyRefCounted> Default for StatementCache<S> {
    fn default() -> Self {
        Self {
            statements: StringHashMap::default(),
            len: 0,
            clock: 0,
        }
    }
}

impl<S: AnyRefCounted + CellRefCounted> StatementCache<S> {
    pub(crate) fn find(&mut self, query: &[u8], accepts: impl Fn(&S) -> bool) -> Option<RefPtr<S>> {
        let (statement, last_used) = self
            .statements
            .get_mut(query)?
            .iter_mut()
            .find(|(statement, _)| accepts(statement))?;
        self.clock += 1;
        *last_used = self.clock;
        Some(statement.clone())
    }

    pub(crate) fn add(&mut self, query: &[u8], statement: RefPtr<S>) {
        self.len += 1;
        self.clock += 1;
        self.statements
            .get_or_put(query)
            .unwrap_or_oom()
            .value_ptr
            .push((statement, self.clock));
    }

    pub(crate) fn remove(&mut self, statement: &S) -> Option<RefPtr<S>> {
        let mut removed = None;
        self.statements.retain(|_, variants| {
            if let Some(i) = variants
                .iter()
                .position(|(variant, _)| core::ptr::eq(variant.as_ptr(), statement))
            {
                removed = Some(variants.remove(i).0);
            }
            !variants.is_empty()
        });
        self.len -= usize::from(removed.is_some());
        removed
    }

    /// With more than `max`: takes out the statement used longest ago that no request holds.
    pub(crate) fn evict(&mut self, max: usize) -> Option<RefPtr<S>> {
        if self.len <= max {
            return None;
        }
        let (oldest, _) = self
            .statements
            .values()
            .flatten()
            .filter(|(statement, _)| statement.ref_count().get() == 1)
            .min_by_key(|(_, last_used)| *last_used)?;
        let oldest = oldest.clone();
        self.remove(&oldest)
    }
}
