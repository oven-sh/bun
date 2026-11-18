use core::cell::RefCell;

/// The last `N` values that were asked for, the latest first.
pub(crate) struct Recent<K, V, const N: usize>(RefCell<Vec<(K, V)>>);

impl<K, V, const N: usize> Default for Recent<K, V, N> {
    fn default() -> Recent<K, V, N> {
        Recent(RefCell::default())
    }
}

impl<K, V: Clone, const N: usize> Recent<K, V, N> {
    pub(crate) fn find(&self, matches: impl Fn(&K) -> bool) -> Option<V> {
        let mut entries = self.0.borrow_mut();
        let index = entries.iter().position(|(key, _)| matches(key))?;
        entries[..=index].rotate_right(1);
        entries.first().map(|(_, value)| value.clone())
    }

    /// Leaves the order as it is.
    pub(crate) fn find_map<T>(&self, mut map: impl FnMut(&V) -> Option<T>) -> Option<T> {
        self.0.borrow().iter().find_map(|(_, value)| map(value))
    }

    pub(crate) fn insert(&self, key: K, value: V) {
        let mut entries = self.0.borrow_mut();
        entries.truncate(N - 1);
        entries.insert(0, (key, value));
    }

    pub(crate) fn find_or_make<E>(
        &self,
        key: &K,
        make: impl FnOnce() -> Result<V, E>,
    ) -> Result<V, E>
    where
        K: Clone + Eq,
    {
        if let Some(found) = self.find(|it| it == key) {
            return Ok(found);
        }
        let value = make()?;
        self.insert(key.clone(), value.clone());
        Ok(value)
    }
}

/// For values that tell what they were made from.
pub(crate) type RecentSet<V, const N: usize> = Recent<V, V, N>;

impl<V: Clone, const N: usize> RecentSet<V, N> {
    pub(crate) fn find_or_insert(
        &self,
        matches: impl Fn(&V) -> bool,
        make: impl FnOnce() -> crate::Result<V>,
    ) -> crate::Result<V> {
        if let Some(found) = self.find(matches) {
            return Ok(found);
        }
        let value = make()?;
        self.insert(value.clone(), value.clone());
        Ok(value)
    }
}
