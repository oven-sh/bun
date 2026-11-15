use core::hint;
use core::marker::PhantomData;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_ptr::OwnedPtr;

use crate::Guarded;

/// Intrusive next-pointer accessors for `UnboundedQueue<T>` nodes.
///
/// Implement this trait for each node type and route to the appropriate
/// intrusive link field — either a plain pointer field or a packed-pointer
/// field with atomic accessors.
///
/// # Safety
/// Implementors must guarantee that the four methods access the *same*
/// intrusive link field, and that `atomic_*` variants are truly atomic with
/// the given ordering. `item` is always a valid, non-null, properly aligned
/// pointer when called by `UnboundedQueue`.
pub unsafe trait Node: Sized {
    unsafe fn get_next(item: *mut Self) -> *mut Self;
    unsafe fn set_next(item: *mut Self, ptr: *mut Self);
    unsafe fn atomic_load_next(item: *mut Self, ordering: Ordering) -> *mut Self;
    unsafe fn atomic_store_next(item: *mut Self, ptr: *mut Self, ordering: Ordering);
}

/// Intrusive next-pointer field for [`UnboundedQueue<T>`] nodes.
///
/// Embed this as a field in `T` and implement [`Linked`] (which only needs to
/// project to that field) instead of open-coding all four [`Node`] accessors.
/// Centralizes the `AtomicPtr` storage so node types no longer need
/// `addr_of_mut!`/`AtomicPtr::from_ptr` casts over a plain `*mut T` field.
///
/// `#[repr(transparent)]` so it has the same layout as the `?*T` it ports.
#[repr(transparent)]
pub struct Link<T>(AtomicPtr<T>);

impl<T> Link<T> {
    #[inline]
    pub const fn new() -> Self {
        Self(AtomicPtr::new(ptr::null_mut()))
    }
    /// Relaxed null check — for debug assertions only (the queue itself never
    /// reads through `Link` outside the [`Node`] accessors).
    #[inline]
    pub fn is_null(&self) -> bool {
        self.0.load(Ordering::Relaxed).is_null()
    }
}

/// Shorthand for the common [`Node`] case: `T` embeds a [`Link<Self>`] field.
/// Implement this and the blanket `impl<T: Linked> Node for T` below supplies
/// the four accessors. Node types with packed/custom link storage (e.g.
/// `ConcurrentTask`'s `PackedNextPtr`) keep implementing [`Node`] directly.
///
/// # Safety
/// `link()` must always project to the *same* embedded `Link<Self>` field of
/// `*item`. `item` is guaranteed valid, non-null, and properly aligned by
/// [`UnboundedQueue`].
pub unsafe trait Linked: Sized {
    unsafe fn link(item: *mut Self) -> *const Link<Self>;
}

// SAFETY: all four accessors route through `T::link(item)`, which by `Linked`'s
// contract returns the same embedded `Link<Self>` field every time; `Link` is a
// `#[repr(transparent)]` `AtomicPtr`, so atomic ops are truly atomic at the
// requested ordering and the non-atomic get/set degrade to Relaxed (never
// concurrent with the atomic path).
unsafe impl<T: Linked> Node for T {
    #[inline]
    unsafe fn get_next(item: *mut Self) -> *mut Self {
        // SAFETY: `Linked::link` contract — points at a live `Link<Self>` in `*item`.
        unsafe { (*T::link(item)).0.load(Ordering::Relaxed) }
    }
    #[inline]
    unsafe fn set_next(item: *mut Self, p: *mut Self) {
        // SAFETY: `Linked::link` contract — points at a live `Link<Self>` in `*item`.
        unsafe { (*T::link(item)).0.store(p, Ordering::Relaxed) }
    }
    #[inline]
    unsafe fn atomic_load_next(item: *mut Self, ordering: Ordering) -> *mut Self {
        // SAFETY: `Linked::link` contract — points at a live `Link<Self>` in `*item`.
        unsafe { (*T::link(item)).0.load(ordering) }
    }
    #[inline]
    unsafe fn atomic_store_next(item: *mut Self, p: *mut Self, ordering: Ordering) {
        // SAFETY: `Linked::link` contract — points at a live `Link<Self>` in `*item`.
        unsafe { (*T::link(item)).0.store(p, ordering) }
    }
}

pub struct Batch<T: Node> {
    front: *mut T,
    count: usize,
}

impl<T: Node> Default for Batch<T> {
    fn default() -> Self {
        Self {
            front: ptr::null_mut(),
            count: 0,
        }
    }
}

pub struct BatchIterator<T: Node> {
    pub(crate) batch: Batch<T>,
}

impl<T: Node> BatchIterator<T> {
    pub fn next(&mut self) -> *mut T {
        if self.batch.count == 0 {
            return ptr::null_mut();
        }
        let front = self.batch.front;
        debug_assert!(!front.is_null());
        // SAFETY: `front` is non-null (count > 0 invariant) and points to a
        // live node previously linked into this batch by `pop_batch`.
        self.batch.front = unsafe { T::get_next(front) };
        self.batch.count -= 1;
        front
    }
}

impl<T: Node> Batch<T> {
    pub fn len(&self) -> usize {
        self.count
    }

    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    pub fn iterator(self) -> BatchIterator<T> {
        BatchIterator { batch: self }
    }
}

/// Per-arch cache-half-line aligned wrapper for `UnboundedQueue.back`/`.front`.
/// Rust cannot express per-field alignment
/// with a non-literal const, so this newtype is `#[repr(align(N))]`-cfg'd to
/// half the target's cache-line size, keeping producer (CAS on `back`)
/// and consumer (swap on `front`) on separate cache halves.
#[cfg_attr(
    any(
        target_arch = "x86_64",
        target_arch = "aarch64",
        target_arch = "powerpc64",
    ),
    repr(align(64))
)]
#[cfg_attr(
    any(
        target_arch = "arm",
        target_arch = "mips",
        target_arch = "mips64",
        target_arch = "riscv64",
    ),
    repr(align(16))
)]
#[cfg_attr(target_arch = "s390x", repr(align(128)))]
#[cfg_attr(
    not(any(
        target_arch = "x86_64",
        target_arch = "aarch64",
        target_arch = "powerpc64",
        target_arch = "arm",
        target_arch = "mips",
        target_arch = "mips64",
        target_arch = "riscv64",
        target_arch = "s390x",
    )),
    repr(align(32))
)]
pub struct QueuePadded<T>(pub(crate) T);

pub struct UnboundedQueue<T: Node> {
    pub(crate) back: QueuePadded<AtomicPtr<T>>,
    pub(crate) front: QueuePadded<AtomicPtr<T>>,
}

impl<T: Node> Default for UnboundedQueue<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: Node> UnboundedQueue<T> {
    /// Const constructor — `Default` is not usable in `static` initializers.
    #[inline]
    pub const fn new() -> Self {
        Self {
            back: QueuePadded(AtomicPtr::new(ptr::null_mut())),
            front: QueuePadded(AtomicPtr::new(ptr::null_mut())),
        }
    }

    /// # Safety
    /// `item` is not in a queue. It stays valid, and only the queue accesses its link, until
    /// `BatchIterator::next` returns it or the queue and its batches are no longer used.
    pub unsafe fn push(&self, item: NonNull<T>) {
        let item = item.as_ptr();
        // SAFETY: fn contract.
        unsafe { T::set_next(item, ptr::null_mut()) };
        let old_back = self.back.0.swap(item, Ordering::AcqRel);
        if !old_back.is_null() {
            // SAFETY: `old_back` was the previous tail, still live (its `next`
            // is null and no consumer has popped past it yet — see `pop_batch`).
            unsafe { T::atomic_store_next(old_back, item, Ordering::Release) };
        } else {
            self.front.0.store(item, Ordering::Release);
        }
    }

    pub fn pop_batch(&self) -> Batch<T> {
        let mut batch = Batch::<T>::default();

        // Not AcqRel because another thread that sees this `null` doesn't depend on any
        // visible side-effects from this thread.
        let first = self.front.0.swap(ptr::null_mut(), Ordering::Acquire);
        if first.is_null() {
            return batch;
        }
        batch.count += 1;

        // Even though this load is Relaxed, it will always be either `first` or an item
        // pushed *after* `first`, because the Acquire load of `self.front` synchronizes-with
        // the Release store in push. So we know it's reachable from `first`.
        let last = self.back.0.swap(ptr::null_mut(), Ordering::Relaxed);
        debug_assert!(!last.is_null());
        let mut next_item = first;
        while next_item != last {
            next_item = loop {
                // Wait for push to set `next`.
                // SAFETY: `next_item` is on the chain from `first` to `last`; producer
                // guarantees it stays valid until consumer observes its `next`.
                let n = unsafe { T::atomic_load_next(next_item, Ordering::Acquire) };
                if !n.is_null() {
                    break n;
                }
                hint::spin_loop();
            };
            batch.count += 1;
        }

        batch.front = first;
        batch
    }

    pub fn is_empty(&self) -> bool {
        self.back.0.load(Ordering::Acquire).is_null()
    }
}

/// An [`UnboundedQueue`] that owns its items. Dropping it leaks them.
pub struct OwnedQueue<P: OwnedPtr<Target: Node>> {
    queue: UnboundedQueue<P::Target>,
    /// The queue is `Sync` if `P` is `Send`.
    _items: PhantomData<Guarded<P>>,
}

impl<P: OwnedPtr<Target: Node>> OwnedQueue<P> {
    pub const fn new() -> Self {
        Self {
            queue: UnboundedQueue::new(),
            _items: PhantomData,
        }
    }

    pub fn push(&self, item: P) {
        // SAFETY: `OwnedPtr` keeps the item valid and unused until `from_raw`, which follows `next`.
        unsafe { self.queue.push(P::into_raw(item)) };
    }

    /// Dropping the iterator pushes the remaining items back.
    pub fn pop_batch(&self) -> OwnedBatchIterator<'_, P> {
        OwnedBatchIterator {
            rest: self.queue.pop_batch().iterator(),
            queue: self,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }
}

pub struct OwnedBatchIterator<'a, P: OwnedPtr<Target: Node>> {
    rest: BatchIterator<P::Target>,
    queue: &'a OwnedQueue<P>,
}

impl<P: OwnedPtr<Target: Node>> Iterator for OwnedBatchIterator<'_, P> {
    type Item = P;

    fn next(&mut self) -> Option<P> {
        let item = NonNull::new(self.rest.next())?;
        // SAFETY: it came from `into_raw` in `push`, and `pop_batch` gives an item to one caller.
        Some(unsafe { P::from_raw(item) })
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.rest.batch.count, Some(self.rest.batch.count))
    }
}

impl<P: OwnedPtr<Target: Node>> Drop for OwnedBatchIterator<'_, P> {
    fn drop(&mut self) {
        while let Some(item) = self.next() {
            self.queue.push(item);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Item(u8, Link<Item>);
    // SAFETY: always the same field.
    unsafe impl Linked for Item {
        unsafe fn link(item: *mut Self) -> *const Link<Self> {
            // SAFETY: fn contract.
            unsafe { &raw const (*item).1 }
        }
    }

    #[test]
    fn owned_batch_iterator_drop_requeues_the_rest() {
        let queue = OwnedQueue::<Box<Item>>::new();
        for i in 0..3 {
            queue.push(Box::new(Item(i, Link::new())));
        }
        assert_eq!(queue.pop_batch().next().map(|item| item.0), Some(0));
        assert_eq!(
            queue.pop_batch().map(|item| item.0).collect::<Vec<_>>(),
            [1, 2]
        );
        assert!(queue.pop_batch().next().is_none());
    }

    #[test]
    fn two_threads_that_pop_get_every_item_once() {
        const ITEMS: u8 = 100;
        let queue = OwnedQueue::<Box<Item>>::new();
        let push_and_pop = |first: u8| {
            let mut taken = Vec::new();
            for value in first..first + ITEMS {
                queue.push(Box::new(Item(value, Link::new())));
                taken.extend(queue.pop_batch().map(|item| item.0));
            }
            taken
        };
        let mut taken = std::thread::scope(|scope| {
            let other = scope.spawn(|| push_and_pop(ITEMS));
            [push_and_pop(0), other.join().unwrap()].concat()
        });
        taken.extend(queue.pop_batch().map(|item| item.0));
        taken.sort_unstable();
        assert!(taken.into_iter().eq(0..2 * ITEMS));
    }
}
