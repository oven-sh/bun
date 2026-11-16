//! The allocator of macOS keeps large blocks that were freed, and they count as memory in use.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::Mutex;

const LARGE: usize = 128 << 10;
const PAGE: usize = 16 << 10;

pub struct Allocator;

fn is_mapped(size: usize, align: usize) -> bool {
    size >= LARGE && align <= 4096
}

/// Few sizes, so that what was freed fits again.
fn mapped_size(size: usize) -> usize {
    size.next_multiple_of(PAGE.max(size.next_power_of_two() / 16))
}

/// The starts and sizes of blocks that the next frame is likely to need as well.
static KEPT: Mutex<[(usize, usize); 8]> = Mutex::new([(0, 0); 8]);

fn take_kept(size: usize) -> Option<*mut u8> {
    let (start, _) = std::mem::take(KEPT.try_lock().ok()?.iter_mut().find(|it| it.1 == size)?);
    Some(start as *mut u8)
}

fn keep(start: *mut u8, size: usize) -> bool {
    const MAX_BYTES: usize = 8 << 20;
    let Ok(mut kept) = KEPT.try_lock() else {
        return false;
    };
    let has_room = kept.iter().map(|it| it.1).sum::<usize>() + size <= MAX_BYTES;
    kept.iter_mut()
        .find(|it| has_room && it.1 == 0)
        .map(|it| *it = (start as usize, size))
        .is_some()
}

pub fn release_memory() {
    let kept = KEPT
        .try_lock()
        .map(|mut kept| std::mem::take(&mut *kept))
        .unwrap_or_default();
    for (start, size) in kept.into_iter().filter(|it| it.1 > 0) {
        // SAFETY: nothing else knows of it.
        unsafe { libc::munmap(start as *mut libc::c_void, size) };
    }
}

fn map(size: usize) -> *mut u8 {
    let (protection, flags) = (
        libc::PROT_READ | libc::PROT_WRITE,
        libc::MAP_PRIVATE | libc::MAP_ANON,
    );
    // SAFETY: a new mapping.
    let start = unsafe { libc::mmap(std::ptr::null_mut(), size, protection, flags, -1, 0) };
    if start == libc::MAP_FAILED {
        std::ptr::null_mut()
    } else {
        start.cast()
    }
}

// SAFETY: which of the two has a block follows from its layout.
unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if !is_mapped(layout.size(), layout.align()) {
            // SAFETY: the caller's contract.
            return unsafe { System.alloc(layout) };
        }
        let size = mapped_size(layout.size());
        take_kept(size).unwrap_or_else(|| map(size))
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        if !is_mapped(layout.size(), layout.align()) {
            // SAFETY: the caller's contract.
            return unsafe { System.alloc_zeroed(layout) };
        }
        let size = mapped_size(layout.size());
        // SAFETY: it has that many bytes.
        take_kept(size)
            .inspect(|start| unsafe { start.write_bytes(0, layout.size()) })
            .unwrap_or_else(|| map(size))
    }

    unsafe fn dealloc(&self, start: *mut u8, layout: Layout) {
        // SAFETY: the caller's contract.
        unsafe {
            if !is_mapped(layout.size(), layout.align()) {
                System.dealloc(start, layout);
            } else if !keep(start, mapped_size(layout.size())) {
                libc::munmap(start.cast(), mapped_size(layout.size()));
            }
        }
    }

    unsafe fn realloc(&self, start: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let [was_mapped, is_mapped] =
            [layout.size(), size].map(|size| is_mapped(size, layout.align()));
        let [before, after] = [layout.size(), size].map(mapped_size);
        // SAFETY: the caller's contract.
        unsafe {
            if !was_mapped && !is_mapped {
                return System.realloc(start, layout, size);
            }
            if was_mapped && is_mapped && after <= before {
                if after < before {
                    libc::munmap(start.add(after).cast(), before - after);
                }
                return start;
            }
            let moved = self.alloc(Layout::from_size_align_unchecked(size, layout.align()));
            if !moved.is_null() {
                std::ptr::copy_nonoverlapping(start, moved, layout.size().min(size));
                self.dealloc(start, layout);
            }
            moved
        }
    }
}
