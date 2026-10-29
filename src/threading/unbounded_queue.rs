use core::hint;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

/// Intrusive next-pointer field for [`UnboundedQueue<T>`] nodes.
///
/// `#[repr(transparent)]` so it has the same layout as the `?*T` it ports.
#[repr(transparent)]
pub struct Link<T>(AtomicPtr<T>);

impl<T> Link<T> {
    #[inline]
    pub const fn new() -> Self {
        Self(AtomicPtr::new(ptr::null_mut()))
    }
    /// Relaxed null check — for debug assertions only.
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

/// A node type. Implement with `bun_core::intrusive_field!(T, next: Link<T>)`.
pub trait Linked: bun_core::IntrusiveField<Link<Self>> {}

impl<T: bun_core::IntrusiveField<Link<T>>> Linked for T {}

pub struct Batch<T: Linked> {
    pub(crate) front: *mut T,
    pub count: usize,
}

impl<T: Linked> Clone for Batch<T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T: Linked> Copy for Batch<T> {}

impl<T: Linked> Default for Batch<T> {
    fn default() -> Self {
        Self {
            front: ptr::null_mut(),
            count: 0,
        }
    }
}

pub struct BatchIterator<T: Linked> {
    pub batch: Batch<T>,
}

impl<T: Linked> BatchIterator<T> {
    pub fn next(&mut self) -> *mut T {
        if self.batch.count == 0 {
            return ptr::null_mut();
        }
        let front = self.batch.front;
        debug_assert!(!front.is_null());
        // SAFETY: `front` is non-null (count > 0 invariant) and points to a
        // live node previously linked into this batch by `pop_batch`.
        self.batch.front = unsafe { (*T::field_of(front)).0.load(Ordering::Relaxed) };
        self.batch.count -= 1;
        front
    }
}

impl<T: Linked> Batch<T> {
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

pub struct UnboundedQueue<T: Linked> {
    pub(crate) back: QueuePadded<AtomicPtr<T>>,
    pub(crate) front: QueuePadded<AtomicPtr<T>>,
}

impl<T: Linked> Default for UnboundedQueue<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: Linked> UnboundedQueue<T> {
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
        self.push_batch(item, item);
    }

    /// `first..=last` must form a valid intrusive chain of live `T` nodes. The
    /// caller transfers logical ownership of every node in the chain.
    pub(crate) fn push_batch(&self, first: NonNull<T>, last: NonNull<T>) {
        let (first, last) = (first.as_ptr(), last.as_ptr());
        // SAFETY: caller guarantees `last` is a live node (NonNull is non-null).
        unsafe { (*T::field_of(last)).clear() };
        if cfg!(debug_assertions) {
            let mut item = first;
            loop {
                // SAFETY: `item` is reachable from `first` via the link chain,
                // all of which the caller guarantees are valid.
                let next_item = unsafe { (*T::field_of(item)).0.load(Ordering::Relaxed) };
                if next_item.is_null() {
                    break;
                }
                item = next_item;
            }
            debug_assert!(item == last, "`last` should be reachable from `first`");
        }
        let old_back = self.back.0.swap(last, Ordering::AcqRel);
        if !old_back.is_null() {
            // SAFETY: `old_back` was the previous tail, still live (its `next`
            // is null and no consumer has popped past it yet — see `pop`).
            unsafe { (*T::field_of(old_back)).0.store(first, Ordering::Release) };
        } else {
            self.front.0.store(first, Ordering::Release);
        }
    }

    pub fn pop(&self) -> *mut T {
        let mut first = self.front.0.load(Ordering::Acquire);
        if first.is_null() {
            return ptr::null_mut();
        }
        let next_item = loop {
            // SAFETY: `first` is non-null (checked above / from failed CAS below).
            let next_ptr = unsafe { (*T::field_of(first)).0.load(Ordering::Acquire) };
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
            let n = unsafe { (*T::field_of(first)).0.load(Ordering::Acquire) };
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
                let n = unsafe { (*T::field_of(next_item)).0.load(Ordering::Acquire) };
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
