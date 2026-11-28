use core::hint;
use core::marker::PhantomData;
use core::ptr;
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_core::IntrusiveField;
use bun_ptr::IntrusivePtr;

use crate::Guarded;

/// The field of a `T` that links it into an [`UnboundedQueue`].
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
}

/// Implement with `bun_core::intrusive_field!(T, next: Link<Self>)`.
pub trait Linked: IntrusiveField<Link<Self>> {}

impl<T: IntrusiveField<Link<T>>> Linked for T {}

/// SAFETY: `item` is live for `'a`.
#[inline]
unsafe fn next_of<'a, T: Linked>(item: *mut T) -> &'a AtomicPtr<T> {
    // SAFETY: fn contract.
    unsafe { &(*T::field_of(item)).0 }
}

/// What [`UnboundedQueue::pop_batch`] took. Dropping it leaks what is left.
pub struct Batch<P: IntrusivePtr<Target: Linked>> {
    front: *mut P::Target,
    count: usize,
}

impl<P: IntrusivePtr<Target: Linked>> Iterator for Batch<P> {
    type Item = P;

    fn next(&mut self) -> Option<P> {
        if self.count == 0 {
            return None;
        }
        let front = self.front;
        debug_assert!(!front.is_null());
        self.count -= 1;
        // SAFETY: `count` nodes that `push` gave up are linked from `front`, and this one leaves.
        unsafe {
            self.front = next_of(front).load(Ordering::Relaxed);
            Some(P::from_raw(front))
        }
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.count, Some(self.count))
    }
}

impl<P: IntrusivePtr<Target: Linked>> ExactSizeIterator for Batch<P> {}

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
struct QueuePadded<T>(T);

/// Dropping it leaks what it holds.
pub struct UnboundedQueue<P: IntrusivePtr<Target: Linked>> {
    back: QueuePadded<AtomicPtr<P::Target>>,
    front: QueuePadded<AtomicPtr<P::Target>>,
    /// `Sync` if `P` is `Send`.
    _items: PhantomData<Guarded<P>>,
}

impl<P: IntrusivePtr<Target: Linked>> Default for UnboundedQueue<P> {
    fn default() -> Self {
        Self::new()
    }
}

impl<P: IntrusivePtr<Target: Linked>> UnboundedQueue<P> {
    /// Const constructor — `Default` is not usable in `static` initializers.
    #[inline]
    pub const fn new() -> Self {
        Self {
            back: QueuePadded(AtomicPtr::new(ptr::null_mut())),
            front: QueuePadded(AtomicPtr::new(ptr::null_mut())),
            _items: PhantomData,
        }
    }

    pub fn push(&self, item: P) {
        let item = item.into_raw();
        // SAFETY: live until a pop gives it back.
        unsafe { next_of(item) }.store(ptr::null_mut(), Ordering::Relaxed);
        let old_back = self.back.0.swap(item, Ordering::AcqRel);
        if !old_back.is_null() {
            // SAFETY: `old_back` was the previous tail, still live (its `next`
            // is null and no consumer has popped past it yet — see `pop`).
            unsafe { next_of(old_back) }.store(item, Ordering::Release);
        } else {
            self.front.0.store(item, Ordering::Release);
        }
    }

    /// SAFETY: no other thread pops meanwhile: it could free the node that this one reads.
    pub unsafe fn pop(&self) -> Option<P> {
        // SAFETY: fn contract, and `push` gave the node up.
        unsafe {
            let front = self.unlink_front();
            (!front.is_null()).then(|| P::from_raw(front))
        }
    }

    /// SAFETY: as [`pop`](Self::pop).
    unsafe fn unlink_front(&self) -> *mut P::Target {
        let mut first = self.front.0.load(Ordering::Acquire);
        if first.is_null() {
            return ptr::null_mut();
        }
        let next_item = loop {
            // SAFETY: `first` is non-null (checked above / from failed CAS below).
            let next_ptr = unsafe { next_of(first) }.load(Ordering::Acquire);
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
        // `self.front` synchronizes-with the Release store in `push`.
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
            // Wait for `push` to set `next`.
            // SAFETY: `first` is the node we just popped; still valid until we return it.
            let n = unsafe { next_of(first) }.load(Ordering::Acquire);
            if !n.is_null() {
                break n;
            }
            hint::spin_loop();
        };

        self.front.0.store(new_first, Ordering::Release);
        first
    }

    pub fn pop_batch(&self) -> Batch<P> {
        let mut batch = Batch {
            front: ptr::null_mut(),
            count: 0,
        };

        // Not AcqRel because another thread that sees this `null` doesn't depend on any
        // visible side-effects from this thread.
        let first = self.front.0.swap(ptr::null_mut(), Ordering::Acquire);
        if first.is_null() {
            return batch;
        }
        batch.count += 1;

        // Even though this load is Relaxed, it will always be either `first` or an item
        // pushed *after* `first`, because the Acquire load of `self.front` synchronizes-with
        // the Release store in `push`. So we know it's reachable from `first`.
        let last = self.back.0.swap(ptr::null_mut(), Ordering::Relaxed);
        debug_assert!(!last.is_null());
        let mut next_item = first;
        while next_item != last {
            next_item = loop {
                // Wait for `push` to set `next`.
                // SAFETY: `next_item` is on the chain from `first` to `last`; producer
                // guarantees it stays valid until consumer observes its `next`.
                let n = unsafe { next_of(next_item) }.load(Ordering::Acquire);
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
    use bun_ptr::Unique;

    struct Item {
        value: usize,
        next: Link<Item>,
    }

    bun_core::intrusive_field!(Item, next: Link<Self>);

    fn item(value: usize) -> Item {
        let next = Link::new();
        Item { value, next }
    }

    #[test]
    fn gives_boxes_back_in_order() {
        let queue = UnboundedQueue::new();
        (0..3).for_each(|value| queue.push(Box::new(item(value))));
        // SAFETY: there is no other thread.
        assert_eq!(unsafe { queue.pop() }.map(|it| it.value), Some(0));
        let batch = queue.pop_batch();
        assert!(queue.is_empty());
        assert_eq!(batch.len(), 2);
        assert_eq!(batch.map(|it| it.value).collect::<Vec<_>>(), [1, 2]);
    }

    #[test]
    fn takes_an_item_again_while_its_batch_is_walked() {
        let mut items = [item(0), item(1)];
        let queue = UnboundedQueue::new();
        for it in &mut items {
            // SAFETY: `items` is left alone until the queue is empty.
            queue.push(unsafe { Unique::from_raw(it) });
        }
        for mut it in queue.pop_batch() {
            it.value += 10;
            queue.push(it);
        }
        assert_eq!(queue.pop_batch().count(), 2);
        assert_eq!(items.map(|it| it.value), [10, 11]);
    }

    #[test]
    fn frees_what_it_pops_while_other_threads_push() {
        const THREADS: usize = 3;
        const EACH: usize = 20;
        let queue = UnboundedQueue::new();
        let (mut count, mut sum) = (0, 0);
        std::thread::scope(|scope| {
            for _ in 0..THREADS {
                scope.spawn(|| (0..EACH).for_each(|value| queue.push(Box::new(item(value)))));
            }
            while count < THREADS * EACH {
                // SAFETY: the other threads only push.
                let first = unsafe { queue.pop() };
                for it in first.into_iter().chain(queue.pop_batch()) {
                    count += 1;
                    sum += it.value;
                }
                std::thread::yield_now();
            }
        });
        assert_eq!(sum, THREADS * EACH * (EACH - 1) / 2);
    }
}
