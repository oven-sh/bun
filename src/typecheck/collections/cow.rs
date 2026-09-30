// internal/collections/cow.go
use std::collections::BTreeMap;
use std::sync::Arc;

// CopyOnWriteMap is a map that defers cloning of an inherited backing map until the first mutation, and supports nested scopes that share the parent's map for reads but get their own clone on write. The zero value is an empty map ready to use.
#[derive(Debug)]
pub struct CopyOnWriteMap<K, V> {
    m: Option<Arc<BTreeMap<K, V>>>,
    owned: bool,
}

impl<K, V> Default for CopyOnWriteMap<K, V> {
    fn default() -> Self {
        CopyOnWriteMap {
            m: None,
            owned: false,
        }
    }
}

impl<K: Ord + Clone, V: Clone> CopyOnWriteMap<K, V> {
    // Get returns the value for k: None is upstream's `false`.
    pub fn get(&self, k: &K) -> Option<&V> {
        self.m.as_ref()?.get(k)
    }

    // Has reports whether k is in the map.
    pub fn has(&self, k: &K) -> bool {
        self.get(k).is_some()
    }

    // Set assigns v to k, cloning the inherited backing map first if necessary.
    pub fn set(&mut self, k: K, v: V) {
        self.ensure_owned();
        Arc::make_mut(self.m.get_or_insert_default()).insert(k, v);
    }

    fn ensure_owned(&mut self) {
        if self.owned {
            return;
        }
        self.m = Some(Arc::new(match &self.m {
            None => BTreeMap::new(),
            Some(m) => BTreeMap::clone(m),
        }));
        self.owned = true;
    }

    // EnterScope returns the state to assign back to this map where upstream calls the function it returns. While the scope is active, the map shares its current backing storage with the parent scope: reads see the inherited entries, and the first mutation transparently clones the storage so the parent's view is not modified.
    #[must_use]
    pub fn enter_scope(&mut self) -> CopyOnWriteMap<K, V> {
        let saved = CopyOnWriteMap {
            m: self.m.as_ref().map(Arc::clone),
            owned: self.owned,
        };
        self.owned = false;
        saved
    }
}

#[derive(Debug)]
pub struct CopyOnWriteSet<K> {
    m: CopyOnWriteMap<K, ()>,
}

impl<K> Default for CopyOnWriteSet<K> {
    fn default() -> Self {
        CopyOnWriteSet {
            m: CopyOnWriteMap::default(),
        }
    }
}

impl<K: Ord + Clone> CopyOnWriteSet<K> {
    // Has reports whether k is in the set.
    pub fn has(&self, k: &K) -> bool {
        self.m.get(k).is_some()
    }

    // Add adds k to the set, cloning the inherited backing map first if necessary.
    pub fn add(&mut self, k: K) {
        self.m.set(k, ());
    }

    // EnterScope returns the state to assign back to this set where upstream calls the function it returns: see CopyOnWriteMap::enter_scope.
    #[must_use]
    pub fn enter_scope(&mut self) -> CopyOnWriteSet<K> {
        CopyOnWriteSet {
            m: self.m.enter_scope(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_scope_reads_its_parent_and_writes_a_copy() {
        let mut m: CopyOnWriteMap<&str, u32> = CopyOnWriteMap::default();
        assert_eq!(m.get(&"a"), None);
        m.set("a", 1);

        let outer = m.enter_scope();
        assert_eq!(m.get(&"a"), Some(&1));
        m.set("b", 2);
        m.set("a", 3);

        let inner = m.enter_scope();
        assert!(m.has(&"b"));
        m.set("c", 4);
        assert_eq!((m.get(&"a"), m.get(&"c")), (Some(&3), Some(&4)));
        m = inner;
        assert_eq!(
            (m.get(&"a"), m.get(&"b"), m.get(&"c")),
            (Some(&3), Some(&2), None)
        );

        m = outer;
        assert_eq!((m.get(&"a"), m.has(&"b")), (Some(&1), false));
        m.set("d", 5);
        assert_eq!(m.get(&"d"), Some(&5));
    }

    #[test]
    fn a_scope_without_writes_shares_the_map() {
        let mut s: CopyOnWriteSet<u32> = CopyOnWriteSet::default();
        let empty = s.enter_scope();
        assert!(!s.has(&1));
        s = empty;
        s.add(1);
        let saved = s.enter_scope();
        assert!(s.has(&1));
        s.add(2);
        assert!(s.has(&2));
        s = saved;
        assert!(s.has(&1) && !s.has(&2));
    }
}
