// Go value semantics that the ported bodies rely on: nil-able slices and maps, signed lengths, guarded indexing.
// In the crate: bun_collections::HashMap (wyhash). The scratch has no workspace crates.
use std::collections::BTreeMap as UnorderedImpl;

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

// `[]T` stored in a field or passed to a function: a nil-able arena slice, `Copy` like a Go slice header.
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
        a.len() == b.len() && (a.is_empty() || core::ptr::eq(a.as_ptr(), b.as_ptr()))
    }
    // s[lo:hi] with Go's bounds turned into a clamp.
    pub fn sub(self, lo: impl GoIndex, hi: impl GoIndex) -> Self {
        let s = self.as_slice();
        let hi = hi.to_index().unwrap_or(0).min(s.len());
        let lo = lo.to_index().unwrap_or(0).min(hi);
        match s.get(lo..hi) {
            Some(part) => Self(Some(part)),
            None => Self(None),
        }
    }
}

// A local `[]T` under construction. `nil()` is `var x []T`, `make` is `make([]T, len, cap)`.
pub struct SliceBuf<T> {
    pub items: Vec<T>,
    non_nil: bool,
}

impl<T: Copy + Default> SliceBuf<T> {
    pub fn nil() -> Self {
        Self {
            items: Vec::new(),
            non_nil: false,
        }
    }
    pub fn make(len: isize, cap: isize) -> Self {
        let len = usize::try_from(len).unwrap_or(0);
        let mut items = Vec::with_capacity(usize::try_from(cap).unwrap_or(0).max(len));
        items.resize(len, T::default());
        Self {
            items,
            non_nil: true,
        }
    }
    pub fn is_nil(&self) -> bool {
        !self.non_nil
    }
    pub fn len(&self) -> isize {
        self.items.len() as isize
    }
    pub fn push(&mut self, value: T) {
        self.non_nil = true;
        self.items.push(value);
    }
    pub fn extend(&mut self, values: List<'_, T>) {
        if values.len() != 0 {
            self.non_nil = true;
            self.items.extend_from_slice(values.as_slice());
        }
    }
    pub fn at(&self, index: impl GoIndex) -> T {
        index
            .to_index()
            .and_then(|i| self.items.get(i))
            .copied()
            .unwrap_or_default()
    }
    pub fn set(&mut self, index: impl GoIndex, value: T) {
        if let Some(slot) = index.to_index().and_then(|i| self.items.get_mut(i)) {
            *slot = value;
        }
    }
    pub fn truncate(&mut self, len: impl GoIndex) {
        self.items.truncate(len.to_index().unwrap_or(0));
    }
}

// `map[K]V` that nothing ranges over. `None` is the nil map.
pub struct Map<K, V>(Option<UnorderedImpl<K, V>>);

impl<K, V> Default for Map<K, V> {
    fn default() -> Self {
        Self(None)
    }
}

impl<K: Ord, V: Copy + Default> Map<K, V> {
    pub fn make() -> Self {
        Self(Some(UnorderedImpl::new()))
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

// `map[K]V` that some function ranges over: iteration is insertion order.
pub struct OrderedMap<K, V> {
    index: Option<UnorderedImpl<K, usize>>,
    entries: Vec<(K, V)>,
}

impl<K, V> Default for OrderedMap<K, V> {
    fn default() -> Self {
        Self {
            index: None,
            entries: Vec::new(),
        }
    }
}

impl<K: Ord + Copy, V: Copy + Default> OrderedMap<K, V> {
    pub fn make() -> Self {
        Self {
            index: Some(UnorderedImpl::new()),
            entries: Vec::new(),
        }
    }
    pub fn is_nil(&self) -> bool {
        self.index.is_none()
    }
    pub fn len(&self) -> isize {
        self.entries.len() as isize
    }
    pub fn get(&self, key: &K) -> V {
        self.get_ok(key).unwrap_or_default()
    }
    pub fn get_ok(&self, key: &K) -> Option<V> {
        let slot = *self.index.as_ref()?.get(key)?;
        self.entries.get(slot).map(|entry| entry.1)
    }
    #[must_use]
    pub fn set(&mut self, key: K, value: V) -> bool {
        let Some(index) = self.index.as_mut() else {
            return false;
        };
        match index.get(&key) {
            Some(&slot) => {
                if let Some(entry) = self.entries.get_mut(slot) {
                    entry.1 = value;
                }
            }
            None => {
                index.insert(key, self.entries.len());
                self.entries.push((key, value));
            }
        }
        true
    }
    // `for k, v := range m`: the entries present when the loop starts, in insertion order.
    pub fn entry_at(&self, position: usize) -> Option<(K, V)> {
        self.entries.get(position).copied()
    }
}

pub fn compare_strings(a: &[u8], b: &[u8]) -> isize {
    match a.cmp(b) {
        core::cmp::Ordering::Less => -1,
        core::cmp::Ordering::Equal => 0,
        core::cmp::Ordering::Greater => 1,
    }
}

// cmp.Compare on float64: NaN sorts first and equals NaN.
pub fn compare_f64(x: f64, y: f64) -> isize {
    let (x_nan, y_nan) = (x.is_nan(), y.is_nan());
    if x_nan {
        return if y_nan { 0 } else { -1 };
    }
    if y_nan {
        return 1;
    }
    if x < y {
        return -1;
    }
    if x > y {
        return 1;
    }
    0
}

// core.Memoize: the create function runs again when it re-enters itself.
#[derive(Default, Clone, Copy)]
pub struct Memo<T> {
    pub value: T,
    pub done: bool,
}
