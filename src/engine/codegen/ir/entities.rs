//! Indices into the tables of a function.

use core::fmt;
use core::marker::PhantomData;
use core::ops::{Index, IndexMut};

pub trait Entity: Copy {
    fn from_index(index: usize) -> Self;
    fn index(self) -> usize;
}

macro_rules! entities {
    ($($(#[$meta:meta])* $name:ident = $prefix:literal;)*) => {
        $($(#[$meta])*
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        #[allow(unreachable_pub)]
        pub struct $name(pub(crate) u32);

        #[allow(unreachable_pub)]
        impl $name {
            /// Stands where there is none. It is no valid index.
            pub const NONE: Self = Self(u32::MAX);

            #[inline]
            pub fn is_none(self) -> bool {
                self == Self::NONE
            }

            #[inline]
            pub fn expand(self) -> Option<Self> {
                if self.is_none() { None } else { Some(self) }
            }
        }

        impl $crate::ir::Entity for $name {
            #[inline]
            fn from_index(index: usize) -> Self {
                Self(index as u32)
            }

            #[inline]
            fn index(self) -> usize {
                self.0 as usize
            }
        }

        impl core::fmt::Debug for $name {
            fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                if self.is_none() { f.write_str("none") } else { write!(f, concat!($prefix, "{}"), self.0) }
            }
        })*
    };
}

pub(crate) use entities;

entities! {
    /// An instruction and what it produces.
    Value = "v";
    Block = "b";
    Edge = "e";
    /// Storage that `GetVariable` and `SetVariable` name until SSA form is constructed.
    Variable = "var";
    /// Bytes of the frame whose address the function takes.
    Slot = "slot";
    /// An abstract part of memory.
    Heap = "heap";
    /// The values that code which takes over at an exit wants to find.
    State = "state";
    Patchpoint = "patch";
    VectorConstant = "vec";
    /// The keys of a `Switch` or the entries of a `JumpTable`.
    Cases = "cases";
}

/// A vector indexed by one kind of entity.
#[derive(Clone)]
pub struct Table<K, V> {
    items: Vec<V>,
    key: PhantomData<fn(K)>,
}

impl<K, V> Default for Table<K, V> {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            key: PhantomData,
        }
    }
}

impl<K: Entity, V> Table<K, V> {
    pub fn filled(len: usize, value: V) -> Self
    where
        V: Clone,
    {
        Self {
            items: vec![value; len],
            key: PhantomData,
        }
    }

    /// Keeps the allocation.
    pub fn refill(&mut self, len: usize, value: V)
    where
        V: Clone,
    {
        self.items.clear();
        self.items.resize(len, value);
    }

    pub fn grow_to(&mut self, len: usize, value: V)
    where
        V: Clone,
    {
        if len > self.items.len() {
            self.items.resize(len, value);
        }
    }

    #[inline]
    pub fn get(&self, key: K) -> Option<&V> {
        self.items.get(key.index())
    }

    #[inline]
    pub fn push(&mut self, value: V) -> K {
        let key = K::from_index(self.items.len());
        self.items.push(value);
        key
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }

    pub fn reserve(&mut self, additional: usize) {
        self.items.reserve(additional);
    }

    pub fn keys(&self) -> impl DoubleEndedIterator<Item = K> + use<K, V> {
        (0..self.items.len()).map(K::from_index)
    }

    pub fn values(&self) -> core::slice::Iter<'_, V> {
        self.items.iter()
    }

    pub fn values_mut(&mut self) -> core::slice::IterMut<'_, V> {
        self.items.iter_mut()
    }
}

impl<K: Entity, V> Index<K> for Table<K, V> {
    type Output = V;

    #[inline]
    fn index(&self, key: K) -> &V {
        &self.items[key.index()]
    }
}

impl<K: Entity, V> IndexMut<K> for Table<K, V> {
    #[inline]
    fn index_mut(&mut self, key: K) -> &mut V {
        &mut self.items[key.index()]
    }
}

/// A run of items in a pool.
pub struct Span<T> {
    start: u32,
    len: u32,
    item: PhantomData<fn() -> T>,
}

impl<T> Clone for Span<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for Span<T> {}

impl<T> Default for Span<T> {
    fn default() -> Self {
        Self {
            start: 0,
            len: 0,
            item: PhantomData,
        }
    }
}

impl<T> PartialEq for Span<T> {
    fn eq(&self, other: &Self) -> bool {
        (self.start, self.len) == (other.start, other.len)
    }
}

impl<T> Eq for Span<T> {}

impl<T> core::hash::Hash for Span<T> {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        (self.start, self.len).hash(state);
    }
}

impl<T> fmt::Debug for Span<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}+{}", self.start, self.len)
    }
}

impl<T> Span<T> {
    #[inline]
    pub(crate) fn new(start: usize, len: usize) -> Self {
        Self {
            start: start as u32,
            len: len as u32,
            item: PhantomData,
        }
    }

    #[inline]
    pub fn len(self) -> usize {
        self.len as usize
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.len == 0
    }

    #[inline]
    pub(crate) fn range(self) -> core::ops::Range<usize> {
        self.start as usize..(self.start + self.len) as usize
    }

    pub(crate) fn truncate(&mut self, len: usize) {
        self.len = self.len.min(len as u32);
    }
}

/// A span with room to grow.
pub(crate) struct List<T> {
    pub(crate) span: Span<T>,
    capacity: u32,
}

impl<T> Clone for List<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for List<T> {}

impl<T> Default for List<T> {
    fn default() -> Self {
        Self {
            span: Span::default(),
            capacity: 0,
        }
    }
}

/// Holds many short lists in one allocation. Room that a list leaves behind is not used again.
#[derive(Clone)]
pub(crate) struct Pool<T> {
    items: Vec<T>,
}

impl<T> Default for Pool<T> {
    fn default() -> Self {
        Self { items: Vec::new() }
    }
}

impl<T: Copy> Pool<T> {
    #[inline]
    pub(crate) fn add(&mut self, items: impl IntoIterator<Item = T>) -> Span<T> {
        let start = self.items.len();
        self.items.extend(items);
        Span::new(start, self.items.len() - start)
    }

    #[inline]
    pub(crate) fn add_list(&mut self, items: &[T]) -> List<T> {
        List {
            span: self.add(items.iter().copied()),
            capacity: items.len() as u32,
        }
    }

    pub(crate) fn duplicate(&mut self, span: Span<T>) -> Span<T> {
        let start = self.items.len();
        self.items.extend_from_within(span.range());
        Span::new(start, span.len())
    }

    pub(crate) fn duplicate_list(&mut self, list: List<T>) -> List<T> {
        List {
            span: self.duplicate(list.span),
            capacity: list.span.len,
        }
    }

    pub(crate) fn push(&mut self, list: &mut List<T>, item: T) {
        const LEAST_CAPACITY: u32 = 4;
        if list.span.len == list.capacity {
            list.span = self.duplicate(list.span);
            list.capacity = (list.capacity * 2).max(LEAST_CAPACITY);
            self.items
                .resize((list.span.start + list.capacity) as usize, item);
        }
        self.items[list.span.range().end] = item;
        list.span.len += 1;
    }

    pub(crate) fn clear(&mut self) {
        self.items.clear();
    }

    /// At a position in the range of a span.
    #[inline]
    pub(crate) fn item(&self, position: usize) -> T {
        self.items[position]
    }

    /// Adds to the span that `span_from` gives.
    #[inline]
    pub(crate) fn append(&mut self, item: T) {
        self.items.push(item);
    }

    #[inline]
    pub(crate) fn end(&self) -> usize {
        self.items.len()
    }

    #[inline]
    pub(crate) fn span_from(&self, start: usize) -> Span<T> {
        Span::new(start, self.items.len() - start)
    }
}

impl<T> Index<Span<T>> for Pool<T> {
    type Output = [T];

    #[inline]
    fn index(&self, span: Span<T>) -> &[T] {
        &self.items[span.range()]
    }
}

impl<T> IndexMut<Span<T>> for Pool<T> {
    #[inline]
    fn index_mut(&mut self, span: Span<T>) -> &mut [T] {
        &mut self.items[span.range()]
    }
}
