use core::cell::Cell;
use std::rc::Rc;

use bun_collections::StringHashMap;
use bun_core::UnwrapOrOom as _;
use bun_ptr::CellExt as _;

/// By query text. A text has one statement for each set of parameter types it ran with.
pub(crate) struct StatementCache<S> {
    /// Each with the `clock` of its last use.
    statements: Cell<StringHashMap<Vec<(Rc<S>, u64)>>>,
    len: Cell<usize>,
    clock: Cell<u64>,
}

impl<S> Default for StatementCache<S> {
    fn default() -> Self {
        Self {
            statements: Cell::default(),
            len: Cell::new(0),
            clock: Cell::new(0),
        }
    }
}

impl<S> StatementCache<S> {
    pub(crate) fn find(&self, query: &[u8], accepts: impl Fn(&S) -> bool) -> Option<Rc<S>> {
        let mut statements = self.statements.take();
        let found = statements
            .get_mut(query)
            .and_then(|variants| variants.iter_mut().find(|(variant, _)| accepts(variant)))
            .map(|(statement, last_used)| {
                self.clock.update(|clock| clock + 1);
                *last_used = self.clock.get();
                Rc::clone(statement)
            });
        self.statements.put_back(statements);
        found
    }

    pub(crate) fn add(&self, query: &[u8], statement: Rc<S>) {
        self.len.update(|len| len + 1);
        self.clock.update(|clock| clock + 1);
        self.statements.with_taken(|statements| {
            statements
                .get_or_put(query)
                .unwrap_or_oom()
                .value_ptr
                .push((statement, self.clock.get()));
        });
    }

    pub(crate) fn remove(&self, statement: &S) -> Option<Rc<S>> {
        let mut removed = None;
        self.statements.with_taken(|statements| {
            statements.retain(|_, variants| {
                if let Some(i) = variants
                    .iter()
                    .position(|(variant, _)| core::ptr::eq(Rc::as_ptr(variant), statement))
                {
                    removed = Some(variants.remove(i).0);
                }
                !variants.is_empty()
            });
        });
        self.len.update(|len| len - usize::from(removed.is_some()));
        removed
    }

    /// With more than `max`: takes out the statement used longest ago that no request holds.
    pub(crate) fn evict(&self, max: usize) -> Option<Rc<S>> {
        if self.len.get() <= max {
            return None;
        }
        let oldest = self.statements.with_taken(|statements| {
            statements
                .values()
                .flatten()
                .filter(|(statement, _)| Rc::strong_count(statement) == 1)
                .min_by_key(|(_, last_used)| *last_used)
                .map(|(oldest, _)| Rc::clone(oldest))
        })?;
        self.remove(&oldest)
    }
}
