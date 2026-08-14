use core::hint;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

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
    /// Reset to null with Relaxed ordering — used when re-queueing a popped
    /// node so a stale link is not observed by the next push's debug walk.
    #[inline]
    pub fn clear(&self) {
        self.0.store(ptr::null_mut(), Ordering::Relaxed);
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
    pub(crate) front: *mut T,
    pub count: usize,
}

impl<T: Node> Clone for Batch<T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T: Node> Copy for Batch<T> {}

impl<T: Node> Default for Batch<T> {
    fn default() -> Self {
        Self {
            front: ptr::null_mut(),
            count: 0,
        }
    }
}

pub struct BatchIterator<T: Node> {
    pub batch: Batch<T>,
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

    /// `item` must point to a live `T` whose intrusive link is not concurrently
    /// accessed outside this queue. The caller transfers logical ownership of
    /// the node to the queue until a `pop`/`pop_batch` returns it.
    pub fn push(&self, item: NonNull<T>) {
        // SAFETY: `self` is live for the whole call.
        unsafe { Self::push_batch(self, item, item) };
    }

    /// [`push`](Self::push) for a producer whose queue the consumer may free as
    /// soon as the node is visible (`MiniEventLoop::enqueue_task_concurrent`).
    /// A `&self` argument would assert the queue's storage, padding included,
    /// until this returns; [`push_batch`](Self::push_batch) asserts nothing
    /// after its publishing store.
    ///
    /// # Safety
    /// `this` must point to a live queue when called (the consumer may free it
    /// once the node is visible); `item` as for [`push`](Self::push).
    pub unsafe fn push_raw(this: *const Self, item: NonNull<T>) {
        // SAFETY: fn contract.
        unsafe { Self::push_batch(this, item, item) };
    }

    /// `first..=last` must form a valid intrusive chain of live `T` nodes. The
    /// caller transfers logical ownership of every node in the chain.
    ///
    /// The chain becomes visible to the consumer at the `next` store (queue was
    /// non-empty) or the `front` store (queue was empty). A
    /// [`push_raw`](Self::push_raw) caller's queue may be freed from that point
    /// on, so nothing after either store may touch `*this`.
    ///
    /// # Safety
    /// `this` must point to a live queue when called; the consumer may free it
    /// once the chain is visible.
    pub(crate) unsafe fn push_batch(this: *const Self, first: NonNull<T>, last: NonNull<T>) {
        let (first, last) = (first.as_ptr(), last.as_ptr());
        // SAFETY: caller guarantees `last` is a live node (NonNull is non-null).
        unsafe { T::set_next(last, ptr::null_mut()) };
        if cfg!(debug_assertions) {
            let mut item = first;
            loop {
                // SAFETY: `item` is reachable from `first` via the link chain,
                // all of which the caller guarantees are valid.
                let next_item = unsafe { T::get_next(item) };
                if next_item.is_null() {
                    break;
                }
                item = next_item;
            }
            debug_assert!(item == last, "`last` should be reachable from `first`");
        }
        // SAFETY: the chain is not visible yet, so `*this` is live (fn contract).
        let old_back = unsafe { (*this).back.0.swap(last, Ordering::AcqRel) };
        if !old_back.is_null() {
            // SAFETY: `old_back` was the previous tail, still live (its `next`
            // is null and no consumer has popped past it yet — see `pop`).
            unsafe { T::atomic_store_next(old_back, first, Ordering::Release) };
        } else {
            // SAFETY: the chain is not visible until this store completes, so
            // `*this` is live for it (fn contract).
            unsafe { (*this).front.0.store(first, Ordering::Release) };
        }
    }

    pub fn pop(&self) -> *mut T {
        let mut first = self.front.0.load(Ordering::Acquire);
        if first.is_null() {
            return ptr::null_mut();
        }
        let next_item = loop {
            // SAFETY: `first` is non-null (checked above / from failed CAS below).
            let next_ptr = unsafe { T::atomic_load_next(first, Ordering::Acquire) };
            match self.front.0.compare_exchange_weak(
                first,
                next_ptr,
                // not AcqRel because we already loaded this value with Acquire
                Ordering::Release,
                Ordering::Acquire,
            ) {
                Ok(_) => break next_ptr,
                Err(maybe_first) => {
                    if maybe_first.is_null() {
                        return ptr::null_mut();
                    }
                    first = maybe_first;
                }
            }
        };
        if !next_item.is_null() {
            return first;
        }
        // `first` was the only item in the queue, so we need to clear `self.back`.

        // Even though this load is Relaxed, it will always be either `first` (in which case
        // the cmpxchg succeeds) or an item pushed *after* `first`, because the Acquire load of
        // `self.front` synchronizes-with the Release store in push/push_batch.
        match self.back.0.compare_exchange(
            first,
            ptr::null_mut(),
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Err(back) => {
                debug_assert!(
                    !back.is_null(),
                    "`back` should not be null while popping an item"
                );
            }
            Ok(_) => return first,
        }

        // Another item was added to the queue before we could finish removing this one.
        let new_first = loop {
            // Wait for push/push_batch to set `next`.
            // SAFETY: `first` is the node we just popped; still valid until we return it.
            let n = unsafe { T::atomic_load_next(first, Ordering::Acquire) };
            if !n.is_null() {
                break n;
            }
            hint::spin_loop();
        };

        self.front.0.store(new_first, Ordering::Release);
        first
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
        // the Release store in push/push_batch. So we know it's reachable from `first`.
        let last = self.back.0.swap(ptr::null_mut(), Ordering::Relaxed);
        debug_assert!(!last.is_null());
        let mut next_item = first;
        while next_item != last {
            next_item = loop {
                // Wait for push/push_batch to set `next`.
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

#[cfg(test)]
mod tests {
    use super::*;

    struct Node(Link<Node>);

    // SAFETY: `0` is the node's only link field.
    unsafe impl Linked for Node {
        unsafe fn link(item: *mut Self) -> *const Link<Self> {
            // SAFETY: `item` is a live node (queue contract).
            unsafe { ptr::addr_of!((*item).0) }
        }
    }

    struct SendPtr<T>(*mut T);
    // SAFETY: the tests below only dereference the pointer on the thread that
    // currently owns the pointee (see each use).
    unsafe impl<T> Send for SendPtr<T> {}

    // The consumer of a `push_raw` producer may free the queue as soon as the
    // node is visible (`MiniEventLoop::enqueue_task_concurrent`: the node can be
    // the last thing the loop's owner was waiting for), so `push_batch` must not
    // touch `*this` after its publishing store. Under Miri (`bun run
    // rust:miri`) any such access is reported as a race with the consumer's
    // free, whatever the interleaving; natively this only checks delivery. The
    // two passes cover the publishing store on `front` (empty queue) and on the
    // previous tail's link (non-empty queue, where the consumer also writes
    // `front` itself while taking the second node).
    #[test]
    fn consumer_may_free_the_queue_once_the_node_is_visible() {
        let iterations = if cfg!(miri) { 64 } else { 10_000 };
        for prefill in [false, true] {
            for _ in 0..iterations {
                let queue = Box::into_raw(Box::new(UnboundedQueue::<Node>::new()));
                let mut first = Node(Link::new());
                let mut second = Node(Link::new());
                let expected = if prefill {
                    // SAFETY: the queue was just allocated and nothing else
                    // refers to it yet.
                    unsafe { (*queue).push(NonNull::from(&mut first)) };
                    2
                } else {
                    1
                };

                let consumer = {
                    let queue = SendPtr(queue);
                    std::thread::spawn(move || {
                        let queue = queue;
                        // Addresses, so the result can cross back to the producer.
                        let mut popped: Vec<usize> = Vec::with_capacity(expected);
                        while popped.len() < expected {
                            // SAFETY: the queue is live until this thread frees
                            // it below.
                            let node = unsafe { (*queue.0).pop() };
                            if node.is_null() {
                                std::thread::yield_now();
                            } else {
                                popped.push(node as usize);
                            }
                        }
                        // Every node the producer will ever push has arrived:
                        // the property under test is that freeing here is
                        // fine whatever the producer is still doing.
                        // SAFETY: allocated with `Box::new` above; the producer
                        // holds no reference to it, only the pointer it posts
                        // through, and it never dereferences that again.
                        drop(unsafe { Box::from_raw(queue.0) });
                        popped
                    })
                };

                // SAFETY: the queue is live at least until this node is
                // visible, which is all `push_raw` requires.
                unsafe { UnboundedQueue::push_raw(queue, NonNull::from(&mut second)) };

                let popped = consumer.join().unwrap();
                let mut want = Vec::new();
                if prefill {
                    want.push(&raw mut first as usize);
                }
                want.push(&raw mut second as usize);
                assert_eq!(popped, want);
            }
        }
    }
}
