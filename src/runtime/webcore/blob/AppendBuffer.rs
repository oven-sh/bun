//! Backing storage shared by the Blobs produced by `b = new Blob([b, chunk])`.
//!
//! `new Blob(parts)` copies every part into a fresh store, so that idiom
//! re-copies the whole prefix on every step and costs O(total²). When the
//! first part is a Blob viewing a whole in-memory store, the result is built on
//! an [`AppendBuffer`] instead: one allocation, carrying spare capacity, shared
//! by every store that successive appends produce. Each of those stores is an
//! ordinary immutable `Bytes` viewing the prefix `[0, len)` of the buffer.
//! Appending onto the store that views the longest published prefix claims
//! `[len, len + n)`, fills it and publishes a new store of length `len + n`;
//! nothing an existing store can see is ever written again, so readers of the
//! older stores (including ones on other threads) are unaffected. Once the
//! buffer is full the next append allocates a bigger one with headroom, which
//! keeps the total number of bytes copied linear in the final size.
//!
//! The buffer rides along in `Bytes::allocator` the same way
//! `LinuxMemFdAllocator` does: every store built on it owns one reference,
//! released by the vtable's `free` when the store's `Bytes` is dropped.

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
    /// Length of the longest prefix published as a store. `[0, committed)` is
    /// initialized and immutable; an append moves it forward with a CAS, so two
    /// appends onto the same prefix cannot both claim the tail.
    committed: AtomicUsize,
}

impl Drop for AppendBuffer {
    fn drop(&mut self) {
        // SAFETY: `ptr`/`capacity` came out of the `Vec` in `create` (or were
        // reset to an empty Vec's by `take_unique_storage`), and the refcount
        // reaching zero means no store points into the allocation.
        drop(unsafe { Vec::from_raw_parts(self.ptr.as_ptr(), 0, self.capacity) });
    }
}

/// Releases the reference the dropped store's `Bytes` held. `buf` is that
/// store's prefix view, not an allocation of its own; the memory goes away
/// with the buffer's last store.
unsafe fn free(buffer: *mut c_void, _buf: &mut [u8], _: Alignment, _: usize) {
    // SAFETY: `buffer` is the pointer `allocator()` stored in this `Bytes`,
    // and that `Bytes` owned one reference (see `store`).
    unsafe { bun_ptr::ThreadSafeRefCount::<AppendBuffer>::deref(buffer.cast::<AppendBuffer>()) };
}

/// Its address identifies buffer-backed `Bytes`, like the memfd vtable does.
static VTABLE: &AllocatorVTable = &AllocatorVTable::free_only(free);

impl AppendBuffer {
    /// The store whose bytes open the result when `blob` is the first part of
    /// `new Blob(parts)`, if appending onto it is possible: in memory,
    /// non-empty, and viewed in full (so the result's first bytes are exactly
    /// the store's bytes, and for a buffer-backed store the append can extend
    /// it in place).
    pub(crate) fn prefix_store(blob: &Blob) -> Option<&StoreRef> {
        let store = blob.store()?;
        let Data::Bytes(bytes) = &store.data else {
            return None;
        };
        (blob.offset.get() == 0 && bytes.len() > 0 && blob.size.get() == bytes.len())
            .then_some(store)
    }

    /// Whether other stores can view the same memory as this store's bytes, in
    /// which case the bytes must not be handed out writable even when the
    /// store itself has a single reference.
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

    /// For `Bytes::to_internal_blob`: when `bytes` is the only store built on
    /// its buffer, hands the allocation over as a `Vec` of the bytes the store
    /// viewed instead of copying them, and leaves `bytes` empty. `None` when
    /// `bytes` is not buffer-backed or the buffer is shared.
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
        // SAFETY: `bytes` owns the only reference, so nothing else can reach the
        // buffer or its allocation. `ptr` is the allocation `create` made,
        // `capacity` is what the `Vec` there reported, and `[0, len)` is
        // initialized. The header is left describing an empty `Vec`, so the
        // deref below (the reference `bytes` owned, which its `free` will no
        // longer release now that `bytes.ptr` is `None`) frees only the header.
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
            // The buffer is full, or another append already claimed its tail.
            // This is at least the second append onto this data, so leave room
            // for the next one; the first append (onto a plain store) stays an
            // exact-size copy so a one-off `new Blob([blob, x])` costs what it
            // did before.
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
        // SAFETY: caller contract. The header's fields are only ever written
        // by `take_unique_storage`, which needs the buffer's single remaining
        // store exclusively, while this call holds a store of the buffer
        // shared; so nothing writes the header during this shared borrow.
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
        // SAFETY: the CAS made this call the only writer of `[old_len,
        // new_len)`, which lies inside the allocation and which no store views
        // until the one created below is published.
        unsafe { write_suffix(buffer.ptr.as_ptr().add(old_len), suffix) };

        // SAFETY: `this` is live (caller contract); the new store gets its
        // own reference.
        unsafe { bun_ptr::ThreadSafeRefCount::<AppendBuffer>::ref_(this) };
        // SAFETY: `[0, new_len)` is initialized and the reference taken above
        // belongs to the new store.
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
        // `len <= capacity`, and nothing else points into `storage` yet.
        let ptr = storage.as_mut_ptr();
        // SAFETY: the ranges `[0, prefix.len())` and `[prefix.len(), len)` are
        // inside the reserved capacity, and `prefix` lives in some other
        // allocation (a store's bytes), so the copies cannot overlap.
        unsafe {
            core::ptr::copy_nonoverlapping(prefix.as_ptr(), ptr, prefix.len());
            write_suffix(ptr.add(prefix.len()), suffix);
        }
        let buffer = bun_core::heap::into_raw(Box::new(AppendBuffer {
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            // SAFETY: `Vec::as_mut_ptr` is non-null even for a zero-length
            // buffer, and `len > 0` here anyway (`prefix` is non-empty).
            ptr: unsafe { NonNull::new_unchecked(ptr) },
            capacity,
            committed: AtomicUsize::new(len),
        }));
        // SAFETY: `[0, len)` was just written, and the reference `init()`
        // created belongs to the first store.
        unsafe { Self::store(buffer, len, is_all_ascii) }
    }

    /// A store viewing `[0, len)` of the buffer.
    ///
    /// # Safety
    /// `this` must be live, `[0, len)` must be initialized, and the caller
    /// must hand over one reference on the buffer, which the store's `Bytes`
    /// releases through [`free`].
    unsafe fn store(this: *mut AppendBuffer, len: usize, is_all_ascii: Option<bool>) -> StoreRef {
        // SAFETY: `this` is live (caller contract); this only copies the field.
        let ptr = unsafe { (*this).ptr }.as_ptr();
        let len = len as SizeType;
        // SAFETY: `ptr[..len]` is initialized (caller contract) and stays valid
        // until `free` releases the reference the caller handed over. `cap ==
        // len` so `allocated_slice()` covers only what this store can read.
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
/// `dst` must be valid for writing `suffix.len` bytes that no node of the
/// joiner reads from (the nodes are either joiner-owned or borrowed from
/// already published bytes; the destination is never published yet).
unsafe fn write_suffix(dst: *mut u8, suffix: &StringJoiner<'_>) {
    let mut written = 0usize;
    for node in suffix.node_slices() {
        // SAFETY: `written + node.len() <= suffix.len` because `suffix.len` is
        // the sum of the node lengths; non-overlap is the caller's contract.
        unsafe { core::ptr::copy_nonoverlapping(node.as_ptr(), dst.add(written), node.len()) };
        written += node.len();
    }
    debug_assert_eq!(written, suffix.len);
}
