use bun_collections::StringHashMap;
use bun_core::UnwrapOrOom as _;
use bun_ptr::{AnyRefCounted, CellRefCounted, RefPtr};

/// By query text. A text has one statement for each set of parameter types it ran with.
pub(crate) struct StatementCache<S: AnyRefCounted> {
    /// Each with the `clock` of its last use.
    statements: StringHashMap<Vec<(RefPtr<S>, u64)>>,
    clock: u64,
}

impl<S: AnyRefCounted> Default for StatementCache<S> {
    fn default() -> Self {
        Self {
            statements: StringHashMap::default(),
            clock: 0,
        }
    }
}

impl<S: AnyRefCounted + CellRefCounted> StatementCache<S> {
    /// As the mariadb connector's `prepareCacheLength`.
    const MAX_STATEMENTS: usize = 256;

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
        removed
    }

    /// Over the limit: takes out the statement used longest ago that no request holds.
    pub(crate) fn evict(&mut self) -> Option<RefPtr<S>> {
        let mut count: usize = 0;
        let mut oldest: Option<&(RefPtr<S>, u64)> = None;
        for entry in self.statements.values().flatten() {
            count += 1;
            if entry.0.ref_count().get() == 1 && oldest.is_none_or(|oldest| entry.1 < oldest.1) {
                oldest = Some(entry);
            }
        }
        if count <= Self::MAX_STATEMENTS {
            return None;
        }
        let oldest = oldest?.0.clone();
        self.remove(&oldest)
    }
}
