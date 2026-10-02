//! Backing storage shared by the Blobs produced by `b = new Blob([b, chunk])`,
//! which otherwise re-copies the whole prefix on every step.
//!
//! One allocation with spare capacity is shared by every store that successive
//! appends produce; each store is an ordinary immutable `Bytes` viewing the
//! prefix `[0, len)`. An append onto the store viewing the longest published
//! prefix claims `[len, len + n)` and publishes a new store; bytes an existing
//! store can see are never written again. A full buffer is replaced by a
//! bigger one with headroom, so the bytes copied stay linear overall.
//!
//! Like `LinuxMemFdAllocator`, the buffer travels in `Bytes::allocator`: every
//! store built on it owns one reference, released by the vtable's `free`.

use core::ffi::c_void;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_alloc::{Alignment, AllocatorVTable, StdAllocator};
use bun_core::UnwrapOrOom as _;
use bun_core::string_joiner::StringJoiner;

use super::store::{Bytes, Data, Store, StoreRef};
use super::{Blob, SizeType};

#[derive(bun_ptr::ThreadSafeRefCounted)]
pub(crate) struct AppendBuffer {
    ref_count: bun_ptr::ThreadSafeRefCount<AppendBuffer>,
    /// `capacity` bytes from the global allocator, never reallocated: stores
    /// point straight into it.
    ptr: NonNull<u8>,
    capacity: usize,
    /// Length of the longest prefix published as a store; advanced by CAS so
    /// two appends onto the same prefix cannot both claim the tail.
    committed: AtomicUsize,
}

impl Drop for AppendBuffer {
    fn drop(&mut self) {
        // SAFETY: `ptr`/`capacity` describe the `Vec` from `create` (or an
        // empty one after `take_unique_storage`); no store points into it.
        drop(unsafe { Vec::from_raw_parts(self.ptr.as_ptr(), 0, self.capacity) });
    }
}

/// Releases the dropped store's reference; `_buf` is only its prefix view.
unsafe fn free(buffer: *mut c_void, _buf: &mut [u8], _: Alignment, _: usize) {
    // SAFETY: `buffer` is the context `store` put in the `Bytes`' allocator,
    // together with the reference released here.
    unsafe { bun_ptr::ThreadSafeRefCount::<AppendBuffer>::deref(buffer.cast::<AppendBuffer>()) };
}

/// Its address identifies buffer-backed `Bytes`, like the memfd vtable does.
static VTABLE: &AllocatorVTable = &AllocatorVTable::free_only(free);

impl AppendBuffer {
    /// `blob`'s store, if the first part of `new Blob(parts)` being this blob
    /// can be appended onto: in memory, non-empty, and viewed in full.
    pub(crate) fn prefix_store(blob: &Blob) -> Option<&StoreRef> {
        let store = blob.store()?;
        let Data::Bytes(bytes) = &store.data else {
            return None;
        };
        (blob.offset.get() == 0 && bytes.len() > 0 && blob.size.get() == bytes.len())
            .then_some(store)
    }

    /// Whether other stores view the same memory, so that even a store with a
    /// single reference must not hand its bytes out writable.
    pub(crate) fn shares_allocation(store: &Store) -> bool {
        let Data::Bytes(bytes) = &store.data else {
            return false;
        };
        let Some(buffer) = Self::from_allocator(bytes.allocator()) else {
            return false;
        };
        // SAFETY: `bytes` holds a reference on the buffer, so it is live.
        !unsafe { &(*buffer).ref_count }.has_one_ref()
    }

    /// For `Bytes::to_internal_blob`: if `bytes` is the only store on its
    /// buffer, moves the allocation out as a `Vec` of the store's bytes and
    /// leaves `bytes` empty. `None` if not buffer-backed or the buffer is shared.
    pub(crate) fn take_unique_storage(bytes: &mut Bytes) -> Option<Vec<u8>> {
        let buffer = Self::from_allocator(bytes.allocator())?;
        // SAFETY: `bytes` holds a reference on the buffer, so it is live.
        if !unsafe { &(*buffer).ref_count }.has_one_ref() {
            return None;
        }
        let ptr = bytes.ptr.take()?;
        let len = core::mem::take(&mut bytes.len) as usize;
        bytes.cap = 0;
        bytes.allocator = bun_alloc::basic::C_ALLOCATOR;
        // SAFETY: `bytes` owns the only reference, so nothing else reaches the
        // buffer; `ptr`/`capacity`/`len` are the `Vec` parts from `create`.
        // Emptying the header first makes the deref (the reference `bytes`
        // owned; with `ptr` taken its `free` no longer runs) free only the header.
        unsafe {
            let capacity = core::mem::replace(&mut (*buffer).capacity, 0);
            (*buffer).ptr = NonNull::dangling();
            bun_ptr::ThreadSafeRefCount::<AppendBuffer>::deref(buffer);
            Some(Vec::from_raw_parts(ptr.as_ptr(), len, capacity))
        }
    }

    /// The store holding `prefix`'s bytes followed by the joiner's contents.
    /// `prefix` must come from [`Self::prefix_store`].
    pub(crate) fn concat(
        prefix: &StoreRef,
        suffix: &StringJoiner<'_>,
        is_all_ascii: Option<bool>,
    ) -> StoreRef {
        let Data::Bytes(prefix_bytes) = &prefix.data else {
            unreachable!("AppendBuffer::concat prefix is not an in-memory store")
        };
        let mut grow = false;
        if let Some(buffer) = Self::from_allocator(prefix_bytes.allocator()) {
            // SAFETY: `prefix_bytes` holds a reference on the buffer.
            if let Some(store) = unsafe { Self::append(buffer, prefix_bytes, suffix, is_all_ascii) }
            {
                return store;
            }
            // Full, or the tail was already claimed. Only this second-or-later
            // append adds headroom; a one-off `new Blob([blob, x])` stays exact.
            grow = true;
        }
        Self::create(prefix_bytes.slice(), suffix, grow, is_all_ascii)
    }

    fn from_allocator(allocator: StdAllocator) -> Option<*mut AppendBuffer> {
        core::ptr::eq(allocator.vtable, VTABLE).then(|| allocator.ptr.cast::<AppendBuffer>())
    }

    /// In-place append: succeeds only when `prefix` views exactly the
    /// committed bytes and the suffix fits.
    ///
    /// # Safety
    /// `prefix` must be a `Bytes` built on `*this` by [`Self::store`], so the
    /// buffer is live for the duration of the call.
    unsafe fn append(
        this: *mut AppendBuffer,
        prefix: &Bytes,
        suffix: &StringJoiner<'_>,
        is_all_ascii: Option<bool>,
    ) -> Option<StoreRef> {
        // SAFETY: live per the caller contract, and only `take_unique_storage`
        // writes the header, which `prefix` being shared here rules out.
        let buffer = unsafe { &*this };
        debug_assert_eq!(prefix.slice().as_ptr(), buffer.ptr.as_ptr());
        let old_len = prefix.len() as usize;
        let new_len = old_len + suffix.len;
        if new_len > buffer.capacity {
            return None;
        }
        buffer
            .committed
            .compare_exchange(old_len, new_len, Ordering::AcqRel, Ordering::Relaxed)
            .ok()?;
        // SAFETY: the CAS made this call the only writer of `[old_len, new_len)`,
        // which is within capacity and not viewed by any store yet.
        unsafe { write_suffix(buffer.ptr.as_ptr().add(old_len), suffix) };

        // SAFETY: `this` is live; this reference becomes the new store's.
        unsafe { bun_ptr::ThreadSafeRefCount::<AppendBuffer>::ref_(this) };
        // SAFETY: `[0, new_len)` is initialized and the reference was just taken.
        Some(unsafe { Self::store(this, new_len, is_all_ascii) })
    }

    /// A fresh buffer holding `prefix` followed by the joiner's contents, with
    /// 50% headroom when `grow` is set.
    fn create(
        prefix: &[u8],
        suffix: &StringJoiner<'_>,
        grow: bool,
        is_all_ascii: Option<bool>,
    ) -> StoreRef {
        let len = prefix.len() + suffix.len;
        let wanted = if grow {
            len.saturating_add(len / 2)
        } else {
            len
        };
        let mut storage: Vec<u8> = Vec::new();
        storage
            .try_reserve_exact(wanted)
            .or_else(|_| storage.try_reserve_exact(len))
            .unwrap_or_oom();
        let mut storage = ManuallyDrop::new(storage);
        let capacity = storage.capacity();
        let ptr = storage.as_mut_ptr();
        // SAFETY: `len <= capacity`, and the sources live in other allocations.
        unsafe {
            core::ptr::copy_nonoverlapping(prefix.as_ptr(), ptr, prefix.len());
            write_suffix(ptr.add(prefix.len()), suffix);
        }
        let buffer = bun_core::heap::into_raw(Box::new(AppendBuffer {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            // SAFETY: `Vec::as_mut_ptr` is never null.
            ptr: unsafe { NonNull::new_unchecked(ptr) },
            capacity,
            committed: AtomicUsize::new(len),
        }));
        // SAFETY: `[0, len)` was just written; `init()`'s reference goes to
        // this first store.
        unsafe { Self::store(buffer, len, is_all_ascii) }
    }

    /// A store viewing `[0, len)` of the buffer.
    ///
    /// # Safety
    /// `this` must be live with `[0, len)` initialized, and the caller hands
    /// over one reference, which the store's `Bytes` releases through [`free`].
    unsafe fn store(this: *mut AppendBuffer, len: usize, is_all_ascii: Option<bool>) -> StoreRef {
        // SAFETY: `this` is live (caller contract).
        let ptr = unsafe { (*this).ptr }.as_ptr();
        let len = len as SizeType;
        // SAFETY: `ptr[..len]` is initialized and outlives the reference handed
        // over; `cap == len` keeps `allocated_slice()` within this store's view.
        let bytes = unsafe {
            Bytes::from_raw_parts(
                ptr,
                len,
                len,
                StdAllocator {
                    ptr: this.cast::<c_void>(),
                    vtable: VTABLE,
                },
            )
        };
        StoreRef::from(Store::new(Store {
            data: Data::Bytes(bytes),
            mime_type: bun_http_types::MimeType::NONE,
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            is_all_ascii,
        }))
    }
}

/// Writes the joiner's nodes back to back at `dst`.
///
/// # Safety
/// `dst` must be valid for `suffix.len` bytes of writes, and no node may
/// overlap it (unpublished buffer space never does).
unsafe fn write_suffix(dst: *mut u8, suffix: &StringJoiner<'_>) {
    let mut written = 0usize;
    for node in suffix.node_slices() {
        // SAFETY: `suffix.len` is the sum of the node lengths; see the contract.
        unsafe { core::ptr::copy_nonoverlapping(node.as_ptr(), dst.add(written), node.len()) };
        written += node.len();
    }
    debug_assert_eq!(written, suffix.len);
}
