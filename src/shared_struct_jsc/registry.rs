//! The bookkeeping that lets a shared object cross a structured clone by reference.
//!
//! Serializing registers the object and gets a nonce; only the nonce goes on the wire. Deserializing looks the nonce up, so
//! bytes from another process (IPC `advanced` mode, `node:v8.deserialize`) can never name an address, only an object that a
//! live `SerializedScriptValue` in this process still holds. Dropping that value removes the entry.

use std::collections::BTreeMap;
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};

/// Entries by nonce. One entry for each serialization of an object, so two clones of one object hold two entries.
pub(crate) struct Registry<T> {
    entries: BTreeMap<u64, T>,
}

impl<T> Registry<T> {
    pub(crate) const fn new() -> Self {
        Self {
            entries: BTreeMap::new(),
        }
    }

    /// Holds `value` until [`Self::remove`]; returns its nonce, which is never zero and never one that is held.
    pub(crate) fn insert(&mut self, value: T) -> u64 {
        loop {
            let nonce = random_nonce();
            if nonce != 0 && !self.entries.contains_key(&nonce) {
                self.entries.insert(nonce, value);
                return nonce;
            }
        }
    }

    pub(crate) fn get(&self, nonce: u64) -> Option<&T> {
        self.entries.get(&nonce)
    }

    pub(crate) fn remove(&mut self, nonce: u64) -> Option<T> {
        self.entries.remove(&nonce)
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }
}

/// 64 bits that a peer cannot predict: `RandomState` is seeded from the OS.
fn random_nonce() -> u64 {
    RandomState::new().build_hasher().finish()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::Registry;

    #[test]
    fn nonces_are_distinct_and_nonzero() {
        let mut registry = Registry::new();
        let nonces: Vec<u64> = (0..64).map(|i| registry.insert(i)).collect();
        assert!(nonces.iter().all(|&n| n > 0));
        let mut sorted = nonces.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), nonces.len());
        assert_eq!(registry.len(), 64);
    }

    #[test]
    fn get_finds_only_a_held_nonce() {
        let mut registry = Registry::new();
        let a = registry.insert("a");
        let b = registry.insert("b");
        assert_eq!(registry.get(a), Some(&"a"));
        assert_eq!(registry.get(b), Some(&"b"));
        assert_eq!(registry.get(0), None);
        assert_eq!(registry.get(a ^ b ^ 1), None);
    }

    #[test]
    fn remove_releases_exactly_that_entry() {
        let mut registry = Registry::new();
        let a = registry.insert("a");
        let b = registry.insert("b");
        assert_eq!(registry.remove(a), Some("a"));
        assert_eq!(registry.remove(a), None);
        assert_eq!(registry.get(a), None);
        assert_eq!(registry.get(b), Some(&"b"));
        assert_eq!(registry.remove(0), None);
    }

    #[test]
    fn removing_drops_the_held_count() {
        let held = Arc::new(());
        let mut registry = Registry::new();
        let nonce = registry.insert(Arc::clone(&held));
        assert_eq!(Arc::strong_count(&held), 2);
        // A clone made while the entry is held (a deserialize) keeps the object alive past the removal.
        let clone = registry.get(nonce).cloned();
        drop(registry.remove(nonce));
        assert_eq!(Arc::strong_count(&held), 2);
        drop(clone);
        assert_eq!(Arc::strong_count(&held), 1);
    }
}
