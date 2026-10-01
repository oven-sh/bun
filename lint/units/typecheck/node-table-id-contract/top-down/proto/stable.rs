// Append-only stores that grow through a shared reference and never move what they hold.
// A chunk is made once and kept, so a borrow of an element lives as long as the store.
use std::cell::{Cell, OnceCell};

const CHUNKS: usize = 22;

// Chunk c holds first << c elements: the chunk of an index and the offset in it.
#[inline]
fn locate(first: u32, index: u32) -> (usize, usize) {
    let q = index / first + 1;
    let chunk = 31 - q.leading_zeros();
    let start = first.wrapping_mul((1u32 << chunk).wrapping_sub(1));
    (chunk as usize, index.wrapping_sub(start) as usize)
}

#[inline]
fn chunk_len(first: u32, chunk: usize) -> usize {
    (first as usize) << chunk
}

// Words that can be written through a shared reference. A run is contiguous in one chunk.
pub struct StableCells {
    chunks: [OnceCell<Box<[Cell<u32>]>>; CHUNKS],
    len: Cell<u32>,
    first: u32,
}

impl StableCells {
    pub const fn new(first: u32) -> Self {
        Self {
            chunks: [const { OnceCell::new() }; CHUNKS],
            len: Cell::new(0),
            first,
        }
    }
    pub fn len(&self) -> u32 {
        self.len.get()
    }
    fn chunk(&self, chunk: usize) -> Option<&[Cell<u32>]> {
        let cell = self.chunks.get(chunk)?;
        let size = chunk_len(self.first, chunk);
        Some(cell.get_or_init(|| (0..size).map(|_| Cell::new(0)).collect()))
    }
    // Appends a run and returns its start, or None when the store is full.
    pub fn push_run(&self, values: &[u32]) -> Option<u32> {
        let n = u32::try_from(values.len()).ok()?;
        let mut start = self.len.get();
        let (mut chunk, mut offset) = locate(self.first, start);
        if offset + values.len() > chunk_len(self.first, chunk) {
            // The run does not fit in the rest of the chunk: it starts the next one.
            start =
                start.checked_add(u32::try_from(chunk_len(self.first, chunk) - offset).ok()?)?;
            chunk += 1;
            offset = 0;
            if values.len() > chunk_len(self.first, chunk) {
                return None;
            }
        }
        let cells = self.chunk(chunk)?.get(offset..offset + values.len())?;
        for (cell, value) in cells.iter().zip(values) {
            cell.set(*value);
        }
        self.len.set(start.checked_add(n)?);
        Some(start)
    }
    // Forgets everything from `len` on. The words are written again by the next runs.
    pub fn truncate(&self, len: u32) {
        if len < self.len.get() {
            self.len.set(len);
        }
    }
    #[inline]
    pub fn run(&self, start: u32, n: usize) -> Option<&[Cell<u32>]> {
        if start >= self.len.get() {
            return None;
        }
        let (chunk, offset) = locate(self.first, start);
        self.chunks.get(chunk)?.get()?.get(offset..offset + n)
    }
}

// Values that are written once. `get` lends the value for as long as the store lives.
pub struct StableVec<T> {
    chunks: [OnceCell<Box<[OnceCell<T>]>>; CHUNKS],
    len: Cell<u32>,
}

impl<T> StableVec<T> {
    const FIRST: u32 = 1024;
    pub const fn new() -> Self {
        Self {
            chunks: [const { OnceCell::new() }; CHUNKS],
            len: Cell::new(0),
        }
    }
    pub fn len(&self) -> u32 {
        self.len.get()
    }
    // Appends a value and returns its index, or None when the store is full.
    pub fn push(&self, value: T) -> Option<u32> {
        let index = self.len.get();
        let (chunk, offset) = locate(Self::FIRST, index);
        let size = chunk_len(Self::FIRST, chunk);
        let cells = self
            .chunks
            .get(chunk)?
            .get_or_init(|| (0..size).map(|_| OnceCell::new()).collect());
        if cells.get(offset)?.set(value).is_err() {
            return None;
        }
        self.len.set(index.checked_add(1)?);
        Some(index)
    }
    #[inline]
    pub fn get(&self, index: u32) -> Option<&T> {
        if index >= self.len.get() {
            return None;
        }
        let (chunk, offset) = locate(Self::FIRST, index);
        self.chunks.get(chunk)?.get()?.get(offset)?.get()
    }
}
