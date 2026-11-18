//! Memory of the Rust allocator that the collector scans as it scans the stack.

use core::alloc::{AllocError, Allocator, Layout};
use core::cell::Cell;
use core::marker::PhantomData;
use core::ptr::{NonNull, null_mut};
use std::alloc::Global;

use crate::FastHasher;

#[repr(C, align(16))]
struct Header {
    previous: *mut Header,
    next: *mut Header,
    size: usize,
}

#[thread_local]
static FIRST: Cell<*mut Header> = Cell::new(null_mut());

/// The allocator of a container that holds cells for a while. The container stays on its thread.
#[derive(Clone, Copy, Default)]
pub struct RootAlloc(PhantomData<*const ()>);

pub type RootVec<T> = Vec<T, RootAlloc>;
pub type RootBox<T> = Box<T, RootAlloc>;
pub type RootDeque<T> = std::collections::VecDeque<T, RootAlloc>;
pub type RootMap<K, V> = hashbrown::HashMap<K, V, FastHasher, RootAlloc>;
pub type RootSet<K> = hashbrown::HashSet<K, FastHasher, RootAlloc>;

#[inline]
pub fn root_vec<T>() -> RootVec<T> {
    Vec::new_in(RootAlloc(PhantomData))
}

#[inline]
pub fn root_box<T>(value: T) -> RootBox<T> {
    Box::new_in(value, RootAlloc::default())
}

fn with_header(layout: Layout) -> Result<Layout, AllocError> {
    assert!(layout.align() <= align_of::<Header>());
    let size = layout
        .size()
        .checked_add(size_of::<Header>())
        .ok_or(AllocError)?;
    Layout::from_size_align(size, align_of::<Header>()).map_err(|_| AllocError)
}

/// # Safety
/// `header` is followed by `size` bytes and is not in the list.
unsafe fn link(header: NonNull<Header>, size: usize) -> NonNull<[u8]> {
    let next = FIRST.replace(header.as_ptr());
    // SAFETY: the members of the list are live allocations of this thread.
    unsafe {
        header.write(Header {
            previous: null_mut(),
            next,
            size,
        });
        if let Some(next) = next.as_mut() {
            next.previous = header.as_ptr();
        }
        NonNull::slice_from_raw_parts(header.add(1).cast(), size)
    }
}

/// # Safety
/// `memory` came from `link`.
unsafe fn unlink(memory: NonNull<u8>) -> NonNull<u8> {
    // SAFETY: the header is in front of the memory, and its neighbours are live.
    unsafe {
        let header = memory.cast::<Header>().sub(1);
        let Header { previous, next, .. } = header.read();
        match previous.as_mut() {
            Some(previous) => previous.next = next,
            None => FIRST.set(next),
        }
        if let Some(next) = next.as_mut() {
            next.previous = previous;
        }
        header.cast()
    }
}

// SAFETY: forwards to the global allocator, with room for a header.
unsafe impl Allocator for RootAlloc {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        let memory = Global.allocate_zeroed(with_header(layout)?)?;
        // SAFETY: new, and of that size.
        Ok(unsafe { link(memory.cast(), layout.size()) })
    }

    #[inline]
    fn allocate_zeroed(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        self.allocate(layout)
    }

    #[inline]
    unsafe fn deallocate(&self, memory: NonNull<u8>, layout: Layout) {
        // SAFETY: the layout was valid when the memory was allocated with it.
        unsafe { Global.deallocate(unlink(memory), with_header(layout).unwrap_unchecked()) }
    }

    unsafe fn grow(
        &self,
        memory: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        let (old_layout, new_layout) = (with_header(old)?, with_header(new)?);
        // SAFETY: the allocation is back in the list whichever way it goes.
        unsafe {
            let header = unlink(memory);
            match Global.grow_zeroed(header, old_layout, new_layout) {
                Ok(grown) => Ok(link(grown.cast(), new.size())),
                Err(error) => {
                    link(header.cast(), old.size());
                    Err(error)
                }
            }
        }
    }
}

/// Null if there is no memory.
pub fn try_allocate_root_words(count: usize) -> *mut u64 {
    let memory = Layout::array::<u64>(count).map(|layout| RootAlloc::default().allocate(layout));
    match memory {
        Ok(Ok(memory)) => memory.as_ptr().cast(),
        _ => null_mut(),
    }
}

/// # Safety
/// What `try_allocate_root_words` returned for that count on this thread.
pub unsafe fn free_root_words(words: *mut u64, count: usize) {
    // SAFETY: the caller's.
    unsafe {
        let layout = Layout::array::<u64>(count).unwrap_unchecked();
        RootAlloc::default().deallocate(NonNull::new_unchecked(words.cast()), layout);
    }
}

impl core::alloc::AllocatorNightly for RootAlloc {}

/// The address range of each allocation of this thread.
pub(super) fn for_each_range(mut visit: impl FnMut(usize, usize)) {
    let mut header = FIRST.get();
    // SAFETY: the members of the list are live.
    while let Some(current) = unsafe { header.as_ref() } {
        let start = header.expose_provenance() + size_of::<Header>();
        visit(start, start + current.size);
        header = current.next;
    }
}
