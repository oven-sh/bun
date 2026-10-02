// Go value semantics that the ported bodies rely on: nil-able slices and maps, signed lengths, guarded indexing.
use bun_collections::HashMap;
use std::hash::Hash;

// `string` where a record keeps it or a function hands it on: the bytes of a source text, of an arena or of a constant.
pub type Text<'a> = &'a [u8];

pub trait GoIndex: Copy {
    fn to_index(self) -> Option<usize>;
}
impl GoIndex for usize {
    fn to_index(self) -> Option<usize> {
        Some(self)
    }
}
impl GoIndex for isize {
    fn to_index(self) -> Option<usize> {
        usize::try_from(self).ok()
    }
}
impl GoIndex for i32 {
    fn to_index(self) -> Option<usize> {
        usize::try_from(self).ok()
    }
}

// `[]T` stored in a field or passed to a function: a nil-able slice, `Copy` like a Go slice header.
#[derive(Debug)]
pub struct List<'a, T>(Option<&'a [T]>);

impl<T> Clone for List<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for List<'_, T> {}
impl<T> Default for List<'_, T> {
    fn default() -> Self {
        Self(None)
    }
}

impl<'a, T: Copy + Default> List<'a, T> {
    pub const NIL: Self = Self(None);
    pub const fn from_slice(slice: &'a [T]) -> Self {
        Self(Some(slice))
    }
    pub const fn is_nil(self) -> bool {
        self.0.is_none()
    }
    pub fn as_slice(self) -> &'a [T] {
        self.0.unwrap_or(&[])
    }
    pub fn len(self) -> isize {
        self.as_slice().len() as isize
    }
    pub fn at(self, index: impl GoIndex) -> T {
        index
            .to_index()
            .and_then(|i| self.as_slice().get(i))
            .copied()
            .unwrap_or_default()
    }
    pub fn iter(self) -> impl Iterator<Item = T> + 'a {
        self.as_slice().iter().copied()
    }
    // core.Same: same backing array and same length.
    pub fn same(self, other: Self) -> bool {
        let (a, b) = (self.as_slice(), other.as_slice());
        a.len() == b.len() && (a.is_empty() || std::ptr::eq(a.as_ptr(), b.as_ptr()))
    }
    // s[lo:hi] with Go's bounds turned into a clamp: a part of the nil list is the nil list.
    pub fn sub(self, lo: impl GoIndex, hi: impl GoIndex) -> Self {
        let Some(s) = self.0 else {
            return Self(None);
        };
        let hi = hi.to_index().unwrap_or(0).min(s.len());
        let lo = lo.to_index().unwrap_or(0).min(hi);
        Self(Some(s.get(lo..hi).unwrap_or(&[])))
    }
}

// A `[]T` that upstream writes after it shared it: the holders see the writes. Identity is the address, as for `List`.
pub struct LiveList<'a, T>(Option<&'a [std::cell::Cell<T>]>);

impl<T> Clone for LiveList<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for LiveList<'_, T> {}
impl<T> Default for LiveList<'_, T> {
    fn default() -> Self {
        Self(None)
    }
}

impl<'a, T: Copy + Default> LiveList<'a, T> {
    pub const NIL: Self = Self(None);
    pub const fn from_cells(cells: &'a [std::cell::Cell<T>]) -> Self {
        Self(Some(cells))
    }
    pub const fn is_nil(self) -> bool {
        self.0.is_none()
    }
    fn cells(self) -> &'a [std::cell::Cell<T>] {
        self.0.unwrap_or(&[])
    }
    pub fn len(self) -> isize {
        self.cells().len() as isize
    }
    pub fn at(self, index: impl GoIndex) -> T {
        index
            .to_index()
            .and_then(|i| self.cells().get(i))
            .map(std::cell::Cell::get)
            .unwrap_or_default()
    }
    // `x[i] = v`. False when the index is out of range.
    #[must_use]
    pub fn set(self, index: impl GoIndex, value: T) -> bool {
        match index.to_index().and_then(|i| self.cells().get(i)) {
            Some(cell) => {
                cell.set(value);
                true
            }
            None => false,
        }
    }
    // The values at the time of each step: a write during the loop is seen, as by Go's `range` over a slice.
    pub fn iter(self) -> impl Iterator<Item = T> + 'a {
        self.cells().iter().map(std::cell::Cell::get)
    }
    pub fn same(self, other: Self) -> bool {
        let (a, b) = (self.cells(), other.cells());
        a.len() == b.len() && (a.is_empty() || std::ptr::eq(a.as_ptr(), b.as_ptr()))
    }
    // s[lo:hi] with Go's bounds turned into a clamp: a part of the nil list is the nil list, and a part shares the cells.
    pub fn sub(self, lo: impl GoIndex, hi: impl GoIndex) -> Self {
        let Some(s) = self.0 else {
            return Self(None);
        };
        let hi = hi.to_index().unwrap_or(0).min(s.len());
        let lo = lo.to_index().unwrap_or(0).min(hi);
        Self(Some(s.get(lo..hi).unwrap_or(&[])))
    }
    pub fn to_vec(self) -> Vec<T> {
        self.iter().collect()
    }
}

// `map[K]V` that nothing ranges over. `None` is the nil map.
pub struct Map<K, V>(Option<HashMap<K, V>>);

impl<K, V> Default for Map<K, V> {
    fn default() -> Self {
        Self(None)
    }
}

impl<K: Hash + Eq, V: Copy + Default> Map<K, V> {
    pub fn make() -> Self {
        Self(Some(HashMap::new()))
    }
    pub fn is_nil(&self) -> bool {
        self.0.is_none()
    }
    pub fn len(&self) -> isize {
        self.0.as_ref().map_or(0, |m| m.len() as isize)
    }
    // `v := m[k]`
    pub fn get(&self, key: &K) -> V {
        self.get_ok(key).unwrap_or_default()
    }
    // `v, ok := m[k]`
    pub fn get_ok(&self, key: &K) -> Option<V> {
        self.0.as_ref().and_then(|m| m.get(key)).copied()
    }
    // `m[k] = v`. Go panics on a nil map: the caller reports `false` as an internal fault.
    #[must_use]
    pub fn set(&mut self, key: K, value: V) -> bool {
        match self.0.as_mut() {
            Some(m) => {
                m.insert(key, value);
                true
            }
            None => false,
        }
    }
    pub fn delete(&mut self, key: &K) {
        if let Some(m) = self.0.as_mut() {
            m.remove(key);
        }
    }
    pub fn clear(&mut self) {
        if let Some(m) = self.0.as_mut() {
            m.clear();
        }
    }
}

// core.Memoize and sync.Once: `done` is set after the create function returns, so a create function that re-enters runs again.
#[derive(Default, Clone, Copy, Debug)]
pub struct Memo<T> {
    pub value: T,
    pub done: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn list_is_a_go_slice() {
        let nil = List::<u32>::NIL;
        assert!(nil.is_nil() && List::<u32>::default().is_nil() && nil.len() == 0);
        let data = [1u32, 2, 3];
        let list = List::from_slice(&data);
        assert_eq!(
            (list.len(), list.at(2usize), list.at(3), list.at(-1)),
            (3, 3, 0, 0)
        );
        assert_eq!(list.iter().collect::<Vec<_>>(), [1, 2, 3]);
        // A part of a list shares its backing array; a part of the nil list is nil.
        assert_eq!(list.sub(1, 3).as_slice(), &[2, 3]);
        assert_eq!(list.sub(-1isize, 9isize).as_slice(), &[1, 2, 3]);
        assert!(list.sub(0, 3).same(list) && !list.sub(1, 3).same(list));
        let empty = list.sub(2, 1);
        assert!(!empty.is_nil() && empty.len() == 0);
        assert!(nil.sub(0, 0).is_nil() && nil.sub(0usize, 3usize).is_nil());
        // core.Same: two empty lists are the same, nil or not.
        assert!(nil.same(List::from_slice(&[])) && empty.same(nil));
    }
}
