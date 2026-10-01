// An append-only store that grows through a shared reference and never moves what it holds.
use std::cell::{Cell, OnceCell};

const CHUNKS: usize = 27;
const FIRST: u32 = 32;

// Chunk c holds FIRST << c values.
#[inline]
fn locate(index: u32) -> (usize, usize) {
    let q = index / FIRST + 1;
    let chunk = 31 - q.leading_zeros();
    let start = FIRST.wrapping_mul((1u32 << chunk).wrapping_sub(1));
    (chunk as usize, index.wrapping_sub(start) as usize)
}

pub struct Stable<T> {
    chunks: [OnceCell<Box<[OnceCell<T>]>>; CHUNKS],
    len: Cell<u32>,
}

impl<T> Default for Stable<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> Stable<T> {
    pub const fn new() -> Self {
        Self {
            chunks: [const { OnceCell::new() }; CHUNKS],
            len: Cell::new(0),
        }
    }
    pub fn len(&self) -> u32 {
        self.len.get()
    }
    // The value lives as long as the store. None when the store is full.
    pub fn push(&self, value: T) -> Option<&T> {
        let index = self.len.get();
        let (chunk, offset) = locate(index);
        let cells = self.chunks.get(chunk)?.get_or_init(|| {
            (0..(FIRST as usize) << chunk)
                .map(|_| OnceCell::new())
                .collect()
        });
        let cell = cells.get(offset)?;
        if cell.set(value).is_err() {
            return None;
        }
        self.len.set(index.checked_add(1)?);
        cell.get()
    }
    pub fn get(&self, index: u32) -> Option<&T> {
        if index >= self.len.get() {
            return None;
        }
        let (chunk, offset) = locate(index);
        self.chunks.get(chunk)?.get()?.get(offset)?.get()
    }
}

// The slices that the open stores and the checker keep: one allocation each, freed with the arena.
pub trait ArenaItem: Copy {
    fn alloc<'a>(arena: &'a Arena, src: &[Self]) -> &'a [Self];
}

macro_rules! define_arena {
    ($($field:ident: $item:ty),* $(,)?) => {
        #[derive(Default)]
        pub struct Arena {
            $($field: Stable<Box<[$item]>>,)*
            allocated: Cell<usize>,
        }
        $(impl ArenaItem for $item {
            fn alloc<'a>(arena: &'a Arena, src: &[Self]) -> &'a [Self] {
                arena.allocated.set(arena.allocated.get() + std::mem::size_of_val(src));
                match arena.$field.push(src.into()) {
                    Some(slice) => slice,
                    None => &[],
                }
            }
        })*
    };
}

define_arena!(
    words: u32,
    bytes: u8,
    node_ids: crate::tscore::ids::NodeId,
    symbol_ids: crate::tscore::ids::SymbolId,
    type_ids: crate::tscore::ids::TypeId,
);

impl Arena {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn alloc_slice_copy<'a, T: ArenaItem>(&'a self, src: &[T]) -> &'a [T] {
        T::alloc(self, src)
    }
    pub fn allocated_bytes(&self) -> usize {
        self.allocated.get()
    }
}
