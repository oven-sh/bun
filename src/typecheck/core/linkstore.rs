// internal/core/linkstore.go. `get` hands out a link where upstream hands out a pointer, so the links of a key stay usable while the store is used for other keys.
use crate::core::arena::Arena;
use std::collections::BTreeMap;
use std::marker::PhantomData;
use std::ops::{Index, IndexMut};

// Links store
pub struct LinkStore<K, V> {
    entries: BTreeMap<K, Link<V>>,
    arena: Arena<V>,
    nil: V,
    sink: V,
}

// `*V` of upstream: the place of a value in the arena of its store. The default is the nil link.
pub struct Link<V>(u32, PhantomData<fn() -> V>);

impl<V> Clone for Link<V> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<V> Copy for Link<V> {}

impl<V> Default for Link<V> {
    fn default() -> Self {
        Link(0, PhantomData)
    }
}

impl<V> PartialEq for Link<V> {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

impl<V> Eq for Link<V> {}

impl<V> std::fmt::Debug for Link<V> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Link({})", self.0)
    }
}

impl<V> Link<V> {
    pub const fn is_nil(self) -> bool {
        self.0 == 0
    }
}

impl<K, V: Default> Default for LinkStore<K, V> {
    fn default() -> Self {
        LinkStore {
            entries: BTreeMap::new(),
            arena: Arena::default(),
            nil: V::default(),
            sink: V::default(),
        }
    }
}

impl<K: Ord + Copy, V: Default> LinkStore<K, V> {
    // The links of `key`, made on the first request.
    pub fn get(&mut self, key: K) -> Link<V> {
        if let Some(&value) = self.entries.get(&key) {
            return value;
        }
        let Some(place) = self.arena.new().checked_add(1) else {
            return Link::default();
        };
        let value = Link(place, PhantomData);
        self.entries.insert(key, value);
        value
    }

    pub fn has(&self, key: K) -> bool {
        self.entries.contains_key(&key)
    }

    // The nil link when the key has no links yet.
    pub fn try_get(&self, key: K) -> Link<V> {
        self.entries.get(&key).copied().unwrap_or_default()
    }
}

// A read through the nil link gives the zero value, where upstream panics.
impl<K, V: Default> Index<Link<V>> for LinkStore<K, V> {
    type Output = V;

    fn index(&self, link: Link<V>) -> &V {
        link.0
            .checked_sub(1)
            .and_then(|index| self.arena.get(index))
            .unwrap_or(&self.nil)
    }
}

// A write through the nil link lands in a scratch value, where upstream panics.
impl<K, V: Default> IndexMut<Link<V>> for LinkStore<K, V> {
    fn index_mut(&mut self, link: Link<V>) -> &mut V {
        match link
            .0
            .checked_sub(1)
            .and_then(|index| self.arena.get_mut(index))
        {
            Some(value) => value,
            None => {
                self.sink = V::default();
                &mut self.sink
            }
        }
    }
}

const PAGE_SHIFT: u32 = 8;
const PAGE_SIZE: usize = 1 << PAGE_SHIFT;
const PAGE_MASK: u64 = PAGE_SIZE as u64 - 1;
const MAX_PAGE_COUNT: u64 = 65536;

// Implements a sparse-array-like structure for storing elements keyed by dense uint64 keys. Elements are stored in fixed-size pages of 256 entries and an index of pages is maintained in an array for lower valued page indices and a map for higher valued page indices.
pub struct PagedLinkStore<V> {
    // Page map for page indices above maxPageCount
    page_map: BTreeMap<u64, Box<[V]>>,
    // Page table for page indices below maxPageCount
    page_list: Vec<Option<Box<[V]>>>,
    sink: V,
}

impl<V: Default> Default for PagedLinkStore<V> {
    fn default() -> Self {
        PagedLinkStore {
            page_map: BTreeMap::new(),
            page_list: Vec::new(),
            sink: V::default(),
        }
    }
}

fn new_page<V: Default>() -> Box<[V]> {
    let mut page: Vec<V> = Vec::with_capacity(PAGE_SIZE);
    page.resize_with(PAGE_SIZE, V::default);
    page.into_boxed_slice()
}

impl<V: Default> PagedLinkStore<V> {
    pub fn get(&mut self, key: u64) -> &mut V {
        let page_index = key >> PAGE_SHIFT;
        let slot = (key & PAGE_MASK) as usize;
        let page = if page_index < MAX_PAGE_COUNT {
            let page_index = page_index as usize;
            if page_index >= self.page_list.len() {
                // Grow the length of the list to pageIndex+1
                self.page_list.resize_with(page_index + 1, || None);
            }
            match self.page_list.get_mut(page_index) {
                Some(page) => page.get_or_insert_with(new_page),
                None => return &mut self.sink,
            }
        } else {
            self.page_map.entry(page_index).or_insert_with(new_page)
        };
        match page.get_mut(slot) {
            Some(value) => value,
            None => &mut self.sink,
        }
    }

    pub fn has(&self, key: u64) -> bool {
        self.try_get(key).is_some()
    }

    // None is upstream's nil: the page of the key does not exist.
    pub fn try_get(&self, key: u64) -> Option<&V> {
        let page_index = key >> PAGE_SHIFT;
        let page = if page_index < MAX_PAGE_COUNT {
            self.page_list.get(page_index as usize)?.as_ref()?
        } else {
            self.page_map.get(&page_index)?
        };
        page.get((key & PAGE_MASK) as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default, Debug, PartialEq)]
    struct Links {
        flags: u32,
        name: Vec<u8>,
    }

    #[test]
    fn link_store() {
        let mut store: LinkStore<u32, Links> = LinkStore::default();
        assert!(!store.has(7));
        assert!(store.try_get(7).is_nil());
        assert_eq!(store[store.try_get(7)], Links::default());

        let links = store.get(7);
        assert!(!links.is_nil());
        store[links].flags = 3;
        let other = store.get(9);
        store[other].name = b"nine".to_vec();
        assert_eq!(store.get(7), links);
        assert_eq!(store.try_get(7), links);
        assert!(store.has(7) && store.has(9) && !store.has(8));
        assert_eq!(store[links].flags, 3);
        assert_eq!(store[other].name, b"nine");

        let nil = Link::default();
        store[nil].flags = 5;
        assert_eq!(store[nil].flags, 0);
    }

    #[test]
    fn paged_link_store() {
        let mut store: PagedLinkStore<u32> = PagedLinkStore::default();
        assert!(!store.has(0));
        assert_eq!(store.try_get(1 << 40), None);
        *store.get(5) = 50;
        *store.get(70_000) = 7;
        *store.get((1 << 40) + 3) = 9;
        assert_eq!(store.try_get(5), Some(&50));
        assert_eq!(store.try_get(6), Some(&0));
        assert_eq!(store.try_get(300), None);
        assert_eq!(store.try_get(70_000), Some(&7));
        assert_eq!(store.try_get((1 << 40) + 3), Some(&9));
        assert_eq!(store.try_get((1 << 40) + 300), None);
        assert!(store.has(5) && store.has(255) && !store.has(256));
        *store.get(5) += 1;
        assert_eq!(*store.get(5), 51);
    }
}
