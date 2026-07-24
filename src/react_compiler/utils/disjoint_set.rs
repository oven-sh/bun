// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! A generic disjoint-set (union-find) data structure.
//!
//! Ported from TypeScript `src/Utils/DisjointSet.ts`.

use std::hash::Hash;

use crate::collections::IndexMap;

/// A Union-Find data structure for grouping items into disjoint sets.
///
/// Corresponds to TS `DisjointSet<T>` in `src/Utils/DisjointSet.ts`.
/// Uses `IndexMap` to preserve insertion order (matching TS `Map` behavior).
pub struct DisjointSet<K: Copy + Eq + Hash> {
    entries: IndexMap<K, K>,
}

impl<K: Copy + Eq + Hash> DisjointSet<K> {
    pub fn new() -> Self {
        DisjointSet {
            entries: IndexMap::new(),
        }
    }

    /// Updates the graph to reflect that the given items form a set,
    /// linking any previous sets that the items were part of into a single set.
    ///
    /// Corresponds to TS `union(items: Array<T>): void`.
    pub fn union(&mut self, items: &[K]) {
        if items.is_empty() {
            return;
        }
        let root = self.find(items[0]);
        for &item in &items[1..] {
            let item_root = self.find(item);
            if item_root != root {
                self.entries.insert(item_root, root);
            }
        }
    }

    /// Find the root of the set containing `item`, with path compression.
    /// If `item` is not in the set, it is inserted as its own root.
    ///
    /// Note: callers that need null/None semantics for missing items should
    /// use `find_opt()` instead.
    pub fn find(&mut self, item: K) -> K {
        let parent = match self.entries.get(&item) {
            Some(&p) => p,
            None => {
                self.entries.insert(item, item);
                return item;
            }
        };
        if parent == item {
            return item;
        }
        let root = self.find(parent);
        self.entries.insert(item, root);
        root
    }

    /// Find the root of the set containing `item`, returning `None` if the item
    /// was never added to the set.
    ///
    /// Corresponds to TS `find(item: T): T | null`.
    pub fn find_opt(&mut self, item: K) -> Option<K> {
        if !self.entries.contains_key(&item) {
            return None;
        }
        Some(self.find(item))
    }

    /// Returns true if the item is present in the set.
    ///
    /// Corresponds to TS `has(item: T): boolean`.
    pub fn has(&self, item: K) -> bool {
        self.entries.contains_key(&item)
    }

    /// Calls the provided callback once for each item in the disjoint set,
    /// passing the item and the group root to which it belongs.
    ///
    /// Corresponds to TS `forEach(fn: (item: T, group: T) => void): void`.
    pub fn for_each<F>(&mut self, mut f: F)
    where
        F: FnMut(K, K),
    {
        let keys: Vec<K> = self.entries.keys().copied().collect();
        for item in keys {
            let group = self.find(item);
            f(item, group);
        }
    }

    /// Returns the number of items in the set.
    ///
    /// Corresponds to TS `get size(): number`.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}
