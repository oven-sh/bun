// Go value semantics that the checker adds to golang.rs: float comparison, memoized getters, slice writes, sets, text lists.
use crate::tscore::golang::{GoIndex, List, Map, SliceBuf, Text};
use crate::tscore::stable::Arena;
use std::hash::Hash;

impl<T: Copy + Default> SliceBuf<T> {
    // `s[i] = v`: a write outside the slice is dropped, the caller reports it when Go would panic.
    pub fn set(&mut self, index: impl GoIndex, value: T) -> bool {
        match index.to_index().and_then(|i| self.items.get_mut(i)) {
            Some(slot) => {
                *slot = value;
                true
            }
            None => false,
        }
    }
    // `s = s[:n]`
    pub fn truncate(&mut self, len: impl GoIndex) {
        self.items.truncate(len.to_index().unwrap_or(0));
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

// collections.Set: the zero value is usable, as upstream's.
pub struct Set<K>(Map<K, bool>);

impl<K> Default for Set<K> {
    fn default() -> Self {
        Self(Map::default())
    }
}

impl<K: Hash + Ord + Copy> Set<K> {
    pub fn has(&self, key: K) -> bool {
        self.0.get(&key)
    }
    pub fn add(&mut self, key: K) {
        if self.0.is_nil() {
            self.0 = Map::make();
        }
        let _ = self.0.set(key, true);
    }
    // AddIfAbsent: true when the key was added.
    pub fn add_if_absent(&mut self, key: K) -> bool {
        if self.has(key) {
            return false;
        }
        self.add(key);
        true
    }
    pub fn delete(&mut self, key: K) {
        self.0.delete(&key);
    }
    pub fn len(&self) -> isize {
        self.0.len()
    }
    pub fn clear(&mut self) {
        self.0.clear();
    }
}

// `[]string` kept by a record: the bytes of all texts and the end of each text.
#[derive(Clone, Copy, Default, Debug)]
pub struct TextList<'a> {
    bytes: Text<'a>,
    ends: List<'a, u32>,
}

impl<'a> TextList<'a> {
    pub const NIL: Self = Self {
        bytes: b"",
        ends: List::NIL,
    };
    pub fn of(arena: &'a Arena, texts: &[&[u8]]) -> Self {
        let mut bytes: Vec<u8> = Vec::new();
        let mut ends: Vec<u32> = Vec::with_capacity(texts.len());
        for text in texts {
            bytes.extend_from_slice(text);
            ends.push(u32::try_from(bytes.len()).unwrap_or(u32::MAX));
        }
        Self {
            bytes: arena.alloc_slice_copy(&bytes),
            ends: List::from_slice(arena.alloc_slice_copy(&ends)),
        }
    }
    pub fn is_nil(self) -> bool {
        self.ends.is_nil()
    }
    pub fn len(self) -> isize {
        self.ends.len()
    }
    pub fn at(self, index: impl GoIndex) -> Text<'a> {
        let Some(i) = index.to_index() else {
            return b"";
        };
        let start = match i.checked_sub(1) {
            Some(previous) => self.ends.at(previous) as usize,
            None => 0,
        };
        let end = self.ends.at(i) as usize;
        self.bytes.get(start..end).unwrap_or(b"")
    }
    pub fn iter(self) -> impl Iterator<Item = Text<'a>> + 'a {
        (0..self.ends.as_slice().len()).map(move |i| self.at(i))
    }
}
