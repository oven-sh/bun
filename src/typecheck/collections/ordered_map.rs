// internal/collections/ordered_map.go
use std::collections::BTreeMap;

// OrderedMap is an insertion ordered map.
#[derive(Clone, Debug)]
pub struct OrderedMap<K, V> {
    keys: Vec<K>,
    mp: BTreeMap<K, V>,
}

impl<K, V> Default for OrderedMap<K, V> {
    fn default() -> Self {
        OrderedMap {
            keys: Vec::new(),
            mp: BTreeMap::new(),
        }
    }
}

// NewOrderedMapWithSizeHint creates a new OrderedMap with a hint for the number of elements it will contain.
pub fn new_ordered_map_with_size_hint<K, V>(hint: isize) -> OrderedMap<K, V> {
    new_map_with_size_hint(hint)
}

pub(crate) fn new_map_with_size_hint<K, V>(hint: isize) -> OrderedMap<K, V> {
    OrderedMap {
        keys: Vec::with_capacity(usize::try_from(hint).unwrap_or(0)),
        mp: BTreeMap::new(),
    }
}

pub struct MapEntry<K, V> {
    pub key: K,
    pub value: V,
}

pub fn new_ordered_map_from_list<K: Ord + Clone, V>(
    items: Vec<MapEntry<K, V>>,
) -> OrderedMap<K, V> {
    let mut mp = new_ordered_map_with_size_hint(items.len() as isize);
    for item in items {
        mp.set(item.key, item.value);
    }
    mp
}

impl<K: Ord + Clone, V> OrderedMap<K, V> {
    // Set sets a key-value pair in the map.
    pub fn set(&mut self, key: K, value: V) {
        if !self.mp.contains_key(&key) {
            self.keys.push(key.clone());
        }
        self.mp.insert(key, value);
    }

    // Get retrieves a value from the map: None is upstream's `false`.
    pub fn get(&self, key: &K) -> Option<&V> {
        self.mp.get(key)
    }

    // GetOrZero retrieves a value from the map, or returns the zero value of the value type if the key is not present.
    pub fn get_or_zero(&self, key: &K) -> V
    where
        V: Clone + Default,
    {
        self.mp.get(key).cloned().unwrap_or_default()
    }

    // EntryAt retrieves the key-value pair at the specified index: None is upstream's `false`.
    pub fn entry_at(&self, index: isize) -> Option<(&K, &V)> {
        let key = self.keys.get(usize::try_from(index).ok()?)?;
        let value = self.mp.get(key)?;
        Some((key, value))
    }

    // Has returns true if the map contains the key.
    pub fn has(&self, key: &K) -> bool {
        self.mp.contains_key(key)
    }

    // Delete removes a key-value pair from the map: None is upstream's `false`.
    pub fn delete(&mut self, key: &K) -> Option<V> {
        let v = self.mp.remove(key)?;

        if let Some(i) = self.keys.iter().position(|k| k == key) {
            // If we're just removing the last element, avoid shifting everything around.
            if i + 1 == self.keys.len() {
                self.keys.pop();
            } else {
                self.keys.remove(i);
            }
        }

        Some(v)
    }

    // Keys returns an iterator over the keys in the map.
    pub fn keys(&self) -> impl Iterator<Item = &K> {
        self.keys.iter()
    }

    // Values returns an iterator over the values in the map.
    pub fn values(&self) -> impl Iterator<Item = &V> {
        self.keys.iter().filter_map(|key| self.mp.get(key))
    }

    // Entries returns an iterator over the key-value pairs in the map.
    pub fn entries(&self) -> impl Iterator<Item = (&K, &V)> {
        self.keys
            .iter()
            .filter_map(|key| self.mp.get(key).map(|value| (key, value)))
    }

    // Clear removes all key-value pairs from the map. The space allocated for the keys will be reused.
    pub fn clear(&mut self) {
        self.keys.clear();
        self.mp.clear();
    }

    // Size returns the number of key-value pairs in the map.
    pub fn size(&self) -> isize {
        self.keys.len() as isize
    }
}

pub fn diff_ordered_maps<K: Ord + Clone, V: PartialEq>(
    m1: &OrderedMap<K, V>,
    m2: &OrderedMap<K, V>,
    on_added: impl FnMut(&K, &V),
    on_removed: impl FnMut(&K, &V),
    on_modified: impl FnMut(&K, &V, &V),
) {
    diff_ordered_maps_func(m1, m2, |a, b| a == b, on_added, on_removed, on_modified);
}

pub fn diff_ordered_maps_func<K: Ord + Clone, V>(
    m1: &OrderedMap<K, V>,
    m2: &OrderedMap<K, V>,
    mut equal_values: impl FnMut(&V, &V) -> bool,
    mut on_added: impl FnMut(&K, &V),
    mut on_removed: impl FnMut(&K, &V),
    mut on_modified: impl FnMut(&K, &V, &V),
) {
    for (k, v2) in m2.entries() {
        if m1.get(k).is_none() {
            on_added(k, v2);
        }
    }
    for (k, v1) in m1.entries() {
        match m2.get(k) {
            Some(v2) => {
                if !equal_values(v1, v2) {
                    on_modified(k, v1, v2);
                }
            }
            None => on_removed(k, v1),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pad_int(i: i32) -> String {
        format!("{i:10}")
    }

    // upstream's TestOrderedMap
    #[test]
    fn ordered_map() {
        let mut m: OrderedMap<i32, String> = OrderedMap::default();

        assert!(!m.has(&1));

        const N: i32 = 1000;
        const START: i32 = 1;
        const END: i32 = START + N;

        // Seed the map with ascending keys and values for easier testing.
        for i in START..END {
            m.set(i, pad_int(i));
        }

        assert_eq!(m.size(), N as isize);

        // Attempt to overwrite existing keys in reverse order.
        for i in (START..END).rev() {
            m.set(i, pad_int(i));
        }

        assert_eq!(m.size(), N as isize);

        for i in START..END {
            assert_eq!(m.get(&i), Some(&pad_int(i)));
        }

        for (k, v) in m.entries() {
            assert_eq!(*v, pad_int(*k));
        }

        let keys: Vec<i32> = m.keys().copied().collect();
        assert_eq!(keys.len(), N as usize);
        assert!(keys.is_sorted());

        let values: Vec<&String> = m.values().collect();
        assert_eq!(values.len(), N as usize);
        assert!(values.is_sorted());

        assert_eq!(m.keys().next(), Some(&START));
        assert_eq!(m.values().next(), Some(&pad_int(START)));
        assert_eq!(m.entries().next(), Some((&START, &pad_int(START))));
        assert_eq!(m.entry_at(1), Some((&(START + 1), &pad_int(START + 1))));
        assert_eq!(m.entry_at(-1), None);
        assert_eq!(m.entry_at(N as isize), None);

        for i in START + 1..END {
            assert_eq!(m.delete(&i), Some(pad_int(i)));
            assert!(!m.has(&i));

            assert_eq!(m.get(&i), None);
            assert_eq!(m.get_or_zero(&i), "");

            assert_eq!(m.delete(&i), None);
        }

        assert_eq!(m.size(), 1);
        assert!(m.has(&START));

        assert_eq!(m.delete(&START), Some(pad_int(START)));

        assert_eq!(m.size(), 0);
    }

    #[test]
    fn insertion_order_survives_deletes_and_clones() {
        let entries = vec![
            MapEntry { key: "c", value: 3 },
            MapEntry { key: "a", value: 1 },
            MapEntry { key: "b", value: 2 },
            MapEntry {
                key: "a",
                value: 10,
            },
        ];
        let mut m = new_ordered_map_from_list(entries);
        assert_eq!(m.keys().copied().collect::<Vec<_>>(), vec!["c", "a", "b"]);
        assert_eq!(m.values().copied().collect::<Vec<_>>(), vec![3, 10, 2]);
        let clone = m.clone();
        assert_eq!(m.delete(&"a"), Some(10));
        m.set("a", 4);
        assert_eq!(m.keys().copied().collect::<Vec<_>>(), vec!["c", "b", "a"]);
        assert_eq!(
            clone.keys().copied().collect::<Vec<_>>(),
            vec!["c", "a", "b"]
        );

        let mut log: Vec<String> = Vec::new();
        let log_cell = std::cell::RefCell::new(&mut log);
        diff_ordered_maps(
            &clone,
            &m,
            |k, v| log_cell.borrow_mut().push(format!("added {k} {v}")),
            |k, v| log_cell.borrow_mut().push(format!("removed {k} {v}")),
            |k, old, new| {
                log_cell
                    .borrow_mut()
                    .push(format!("modified {k} {old} {new}"))
            },
        );
        assert_eq!(log, vec!["modified a 10 4"]);
        m.clear();
        assert_eq!(m.size(), 0);
        assert_eq!(m.keys().count(), 0);
    }
}
