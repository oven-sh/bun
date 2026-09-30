// internal/collections/multimap.go
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
pub struct MultiMap<K, V> {
    pub m: BTreeMap<K, Vec<V>>,
}

impl<K, V> Default for MultiMap<K, V> {
    fn default() -> Self {
        MultiMap { m: BTreeMap::new() }
    }
}

pub fn new_multi_map_with_size_hint<K, V>(_hint: isize) -> MultiMap<K, V> {
    MultiMap::default()
}

pub fn group_by<K: Ord, V: Copy>(items: &[V], mut group_id: impl FnMut(V) -> K) -> MultiMap<K, V> {
    let mut m = MultiMap::default();
    for &item in items {
        m.add(group_id(item), item);
    }
    m
}

impl<K: Ord, V> MultiMap<K, V> {
    pub fn has(&self, key: &K) -> bool {
        self.m.contains_key(key)
    }

    pub fn get(&self, key: &K) -> &[V] {
        self.m.get(key).map_or(&[], Vec::as_slice)
    }

    pub fn add(&mut self, key: K, value: V) {
        self.m.entry(key).or_default().push(value);
    }

    pub fn remove(&mut self, key: &K, value: &V)
    where
        V: PartialEq,
    {
        if let Some(values) = self.m.get_mut(key) {
            if let Some(i) = values.iter().position(|v| v == value) {
                if values.len() == 1 {
                    self.m.remove(key);
                } else {
                    values.remove(i);
                }
            }
        }
    }

    pub fn remove_all(&mut self, key: &K) {
        self.m.remove(key);
    }

    pub fn len(&self) -> isize {
        self.m.len() as isize
    }

    // The keys in ascending order, where upstream's map has no order.
    pub fn keys(&self) -> impl Iterator<Item = &K> {
        self.m.keys()
    }

    // The values in the order of their keys, where upstream's map has no order.
    pub fn values(&self) -> impl Iterator<Item = &[V]> {
        self.m.values().map(Vec::as_slice)
    }

    pub fn clear(&mut self) {
        self.m.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multi_map_operations() {
        let mut m = group_by(&[1u32, 2, 3, 4, 5, 6], |n| n % 3);
        assert_eq!(m.len(), 3);
        assert_eq!(m.get(&0), &[3, 6]);
        assert_eq!(m.get(&1), &[1, 4]);
        assert_eq!(m.get(&7), &[] as &[u32]);
        assert!(m.has(&2) && !m.has(&7));
        m.add(1, 1);
        m.remove(&1, &1);
        assert_eq!(m.get(&1), &[4, 1]);
        m.remove(&1, &9);
        m.remove(&1, &4);
        m.remove(&1, &1);
        assert!(!m.has(&1));
        assert_eq!(m.keys().copied().collect::<Vec<u32>>(), vec![0, 2]);
        assert_eq!(
            m.values().collect::<Vec<&[u32]>>(),
            vec![&[3, 6][..], &[2, 5][..]]
        );
        m.remove_all(&0);
        assert_eq!(m.len(), 1);
        m.clear();
        assert_eq!(m.len(), 0);
        let sized: MultiMap<u32, u32> = new_multi_map_with_size_hint(4);
        assert_eq!(sized.len(), 0);
    }
}
