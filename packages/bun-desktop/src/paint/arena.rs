//! Memory that the CPU and the GPU both read.

use std::alloc::{Layout, handle_alloc_error};
use std::ops::Range;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::sync::Mutex;

const PAGE: usize = 16 << 10;
const SHARED: usize = 2 << 20;
const ALIGNMENT: usize = 64;

/// Whole pages.
pub struct Chunk {
    /// Never reused.
    #[cfg_attr(not(any(test, target_os = "macos")), expect(dead_code))]
    pub id: u64,
    pub start: *mut u8,
    pub len: usize,
    /// Sorted, and no two touch.
    free: Mutex<Vec<Range<usize>>>,
}

// SAFETY: it owns the memory, of which each `Block` has a part to itself.
unsafe impl Send for Chunk {}
// SAFETY: as above.
unsafe impl Sync for Chunk {}

impl Chunk {
    fn new(len: usize) -> Arc<Chunk> {
        static LAST_ID: AtomicU64 = AtomicU64::new(0);
        let len = len.next_multiple_of(PAGE);
        let id = LAST_ID.fetch_add(1, Ordering::Relaxed) + 1;
        Arc::new(Chunk {
            id,
            start: map(len),
            len,
            free: Mutex::new(std::iter::once(0..len).collect()),
        })
    }

    fn take(&self, len: usize) -> Option<usize> {
        let mut free = self.free.lock();
        let index = free.iter().position(|range| range.len() >= len)?;
        let start = free[index].start;
        free[index].start += len;
        if free[index].is_empty() {
            free.remove(index);
        }
        Some(start)
    }

    fn give_back(&self, mut range: Range<usize>) {
        let mut free = self.free.lock();
        let index = free.partition_point(|it| it.start < range.start);
        if free.get(index).is_some_and(|next| next.start == range.end) {
            range.end = free.remove(index).end;
        }
        match index.checked_sub(1).map(|before| &mut free[before]) {
            Some(before) if before.end == range.start => before.end = range.end,
            _ => free.insert(index, range),
        }
    }
}

fn layout(len: usize) -> Layout {
    Layout::from_size_align(len, PAGE).expect("it is the size of something that is in memory")
}

fn map(len: usize) -> *mut u8 {
    #[cfg(unix)]
    {
        let (protection, flags) = (
            libc::PROT_READ | libc::PROT_WRITE,
            libc::MAP_PRIVATE | libc::MAP_ANON,
        );
        // SAFETY: a new mapping.
        let start = unsafe { libc::mmap(std::ptr::null_mut(), len, protection, flags, -1, 0) };
        if start == libc::MAP_FAILED {
            handle_alloc_error(layout(len));
        }
        start.cast()
    }
    #[cfg(not(unix))]
    {
        // SAFETY: `len` is not 0.
        let start = unsafe { std::alloc::alloc_zeroed(layout(len)) };
        if start.is_null() {
            handle_alloc_error(layout(len));
        }
        start
    }
}

impl Drop for Chunk {
    fn drop(&mut self) {
        // SAFETY: what `map` returned, and every `Block` keeps its chunk alive.
        unsafe {
            #[cfg(unix)]
            libc::munmap(self.start.cast(), self.len);
            #[cfg(not(unix))]
            std::alloc::dealloc(self.start, layout(self.len));
        }
    }
}

pub struct Block {
    pub chunk: Arc<Chunk>,
    pub offset: usize,
    len: usize,
}

impl Block {
    pub fn bytes(&self) -> &[u8] {
        // SAFETY: inside of the chunk, and only `Arena::store` writes there.
        unsafe { std::slice::from_raw_parts(self.chunk.start.add(self.offset), self.len) }
    }
}

fn reserved(len: usize) -> usize {
    len.max(1).next_multiple_of(ALIGNMENT)
}

impl Drop for Block {
    fn drop(&mut self) {
        self.chunk
            .give_back(self.offset..self.offset + reserved(self.len));
    }
}

#[derive(Default)]
pub struct Arena(Vec<Arc<Chunk>>);

impl Arena {
    pub fn store(&mut self, bytes: &[u8]) -> Block {
        let needed = reserved(bytes.len());
        let found = self
            .0
            .iter()
            .find_map(|chunk| Some((chunk.take(needed)?, chunk.clone())));
        let (offset, chunk) = found.unwrap_or_else(|| {
            let is_large = needed > SHARED / 4;
            let chunk = Chunk::new(if is_large { needed } else { SHARED });
            if !is_large {
                self.0.push(chunk.clone());
            }
            (chunk.take(needed).unwrap_or(0), chunk)
        });
        // SAFETY: nothing else has this part of the chunk.
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), chunk.start.add(offset), bytes.len())
        };
        Block {
            chunk,
            offset,
            len: bytes.len(),
        }
    }

    pub fn release_empty_chunks(&mut self) {
        self.0.retain(|chunk| {
            chunk
                .free
                .lock()
                .first()
                .is_none_or(|range| range.len() != chunk.len)
        });
    }
}
