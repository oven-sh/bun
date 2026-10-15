//! Sets and maps of handles, by their ids.
//!
//! A handle is a pointer to its file and an id. Two handles are equal where their ids are, so a
//! set of them is a set of ids: a few inline, then a bit for each, in pages.

use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::marker::PhantomData;

/// The index of what a handle stands for, among the things of its kind in the program of its file.
pub trait Indexed: Copy {
    fn index(self) -> u32;
}

/// How many ids a set holds before it has a bit for each.
const FEW: usize = 8;

/// The bits of 512 ids that follow each other: a cache line.
type Page = [u64; 8];

#[inline]
fn place(id: u32) -> (u32, usize, u64) {
    (id >> 9, ((id >> 6) & 7) as usize, 1 << (id & 63))
}

#[derive(Default)]
struct Ids {
    few: SmallVec<[u32; FEW]>,
    /// Empty while `few` holds the set. By the upper bits of an id: ids are given out in order, so
    /// a set is a few runs, but a type that a query makes has an id with a high bit, far from
    /// those of the program.
    pages: FxHashMap<u32, Page>,
    len: usize,
}

impl Ids {
    fn contains(&self, id: u32) -> bool {
        if self.pages.is_empty() {
            return self.few.contains(&id);
        }
        let (page, word, bit) = place(id);
        self.pages.get(&page).is_some_and(|it| it[word] & bit != 0)
    }

    fn set(&mut self, id: u32) -> bool {
        let (page, word, bit) = place(id);
        let word = &mut self.pages.entry(page).or_default()[word];
        let is_new = *word & bit == 0;
        *word |= bit;
        is_new
    }

    fn insert(&mut self, id: u32) -> bool {
        if self.pages.is_empty() {
            if self.few.contains(&id) {
                return false;
            }
            if self.few.len() < FEW {
                self.few.push(id);
                self.len += 1;
                return true;
            }
            for few in std::mem::take(&mut self.few) {
                self.set(few);
            }
        }
        let is_new = self.set(id);
        self.len += is_new as usize;
        is_new
    }

    fn remove(&mut self, id: u32) -> bool {
        let was_there = match self.pages.is_empty() {
            true => {
                let before = self.few.len();
                self.few.retain(|it| *it != id);
                self.few.len() != before
            }
            false => {
                let (page, word, bit) = place(id);
                self.pages.get_mut(&page).is_some_and(|it| {
                    let was_there = it[word] & bit != 0;
                    it[word] &= !bit;
                    was_there
                })
            }
        };
        self.len -= was_there as usize;
        was_there
    }

    fn clear(&mut self) {
        self.few.clear();
        self.pages.clear();
        self.len = 0;
    }
}

/// A set of `T` by id. It cannot be iterated: what is listed is kept in a list.
pub struct IdSet<T> {
    ids: Ids,
    of: PhantomData<fn(T)>,
}

impl<T> Default for IdSet<T> {
    #[inline]
    fn default() -> Self {
        IdSet {
            ids: Ids::default(),
            of: PhantomData,
        }
    }
}

impl<T: Indexed> IdSet<T> {
    #[inline]
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether it was not in the set.
    #[inline]
    pub fn insert(&mut self, it: T) -> bool {
        self.ids.insert(it.index())
    }

    #[inline]
    pub fn contains(&self, it: T) -> bool {
        self.ids.contains(it.index())
    }

    /// Whether it was in the set.
    #[inline]
    pub fn remove(&mut self, it: T) -> bool {
        self.ids.remove(it.index())
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.ids.len == 0
    }

    #[inline]
    pub fn clear(&mut self) {
        self.ids.clear();
    }
}

impl<T: Indexed> Extend<T> for IdSet<T> {
    fn extend<I: IntoIterator<Item = T>>(&mut self, iter: I) {
        for it in iter {
            self.insert(it);
        }
    }
}

impl<T: Indexed> FromIterator<T> for IdSet<T> {
    fn from_iter<I: IntoIterator<Item = T>>(iter: I) -> Self {
        let mut set = IdSet::default();
        set.extend(iter);
        set
    }
}

/// From ids to `V`: a few pairs inline, then a table of ids.
struct IdsTo<V> {
    few: SmallVec<[(u32, V); 4]>,
    /// Empty while `few` holds the map.
    many: FxHashMap<u32, V>,
}

impl<V> IdsTo<V> {
    fn get(&self, id: u32) -> Option<&V> {
        match self.many.is_empty() {
            true => self.few.iter().find(|it| it.0 == id).map(|it| &it.1),
            false => self.many.get(&id),
        }
    }

    fn get_mut(&mut self, id: u32) -> Option<&mut V> {
        match self.many.is_empty() {
            true => self
                .few
                .iter_mut()
                .find(|it| it.0 == id)
                .map(|it| &mut it.1),
            false => self.many.get_mut(&id),
        }
    }

    fn insert(&mut self, id: u32, value: V) -> Option<V> {
        if !self.many.is_empty() {
            return self.many.insert(id, value);
        }
        if let Some(pair) = self.few.iter_mut().find(|it| it.0 == id) {
            return Some(std::mem::replace(&mut pair.1, value));
        }
        if self.few.len() < self.few.inline_size() {
            self.few.push((id, value));
            return None;
        }
        self.many.extend(self.few.drain(..));
        self.many.insert(id, value)
    }

    fn get_or_insert_with(&mut self, id: u32, value: impl FnOnce() -> V) -> &mut V {
        if self.many.is_empty() {
            if let Some(at) = self.few.iter().position(|it| it.0 == id) {
                return &mut self.few[at].1;
            }
            if self.few.len() < self.few.inline_size() {
                self.few.push((id, value()));
                let at = self.few.len() - 1;
                return &mut self.few[at].1;
            }
            self.many.extend(self.few.drain(..));
        }
        self.many.entry(id).or_insert_with(value)
    }

    fn remove(&mut self, id: u32) -> Option<V> {
        if !self.many.is_empty() {
            return self.many.remove(&id);
        }
        let at = self.few.iter().position(|it| it.0 == id)?;
        Some(self.few.swap_remove(at).1)
    }

    fn len(&self) -> usize {
        self.few.len() + self.many.len()
    }
}

/// A map from `T` by id. It cannot be iterated.
pub struct IdMap<T, V> {
    ids: IdsTo<V>,
    of: PhantomData<fn(T)>,
}

impl<T, V> Default for IdMap<T, V> {
    #[inline]
    fn default() -> Self {
        IdMap {
            ids: IdsTo {
                few: SmallVec::new(),
                many: FxHashMap::default(),
            },
            of: PhantomData,
        }
    }
}

impl<T: Indexed, V> IdMap<T, V> {
    #[inline]
    pub fn new() -> Self {
        Self::default()
    }

    /// What `key` had before.
    #[inline]
    pub fn insert(&mut self, key: T, value: V) -> Option<V> {
        self.ids.insert(key.index(), value)
    }

    #[inline]
    pub fn get(&self, key: T) -> Option<&V> {
        self.ids.get(key.index())
    }

    #[inline]
    pub fn get_mut(&mut self, key: T) -> Option<&mut V> {
        self.ids.get_mut(key.index())
    }

    #[inline]
    pub fn contains_key(&self, key: T) -> bool {
        self.ids.get(key.index()).is_some()
    }

    #[inline]
    pub fn remove(&mut self, key: T) -> Option<V> {
        self.ids.remove(key.index())
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.ids.len() == 0
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.ids.len()
    }

    /// The value of `key`, which is `value()` if it had none.
    #[inline]
    pub fn get_or_insert_with(&mut self, key: T, value: impl FnOnce() -> V) -> &mut V {
        self.ids.get_or_insert_with(key.index(), value)
    }

    #[inline]
    pub fn clear(&mut self) {
        self.ids.few.clear();
        self.ids.many.clear();
    }
}

impl<T: Indexed, V> Extend<(T, V)> for IdMap<T, V> {
    fn extend<I: IntoIterator<Item = (T, V)>>(&mut self, iter: I) {
        for (key, value) in iter {
            self.insert(key, value);
        }
    }
}
