//! Idle threads for a step that is too far down the stack to be handed them as an argument.

use bun_threading::Guarded;
use std::cell::Cell;
use std::mem::MaybeUninit;
use std::ptr::NonNull;

/// `in_parallel(n, f)` calls `f(i)` once for every `i < n`, on any number of threads, and returns after the last call.
pub type InParallel<'a> = &'a dyn Fn(usize, &(dyn Fn(usize) + Sync));

type Lent = NonNull<dyn Fn(usize, &(dyn Fn(usize) + Sync))>;

#[thread_local]
static LENT: Cell<Option<Lent>> = Cell::new(None);

struct Restore(Option<Lent>);

impl Drop for Restore {
    fn drop(&mut self) {
        LENT.set(self.0);
    }
}

/// `with_helpers` on this thread gets `in_parallel` until `then` returns.
pub fn lend_helpers<R>(in_parallel: InParallel<'_>, then: impl FnOnce() -> R) -> R {
    // SAFETY: only the lifetime changes, and `Restore` takes the pointer out before the borrow ends.
    let lent = unsafe { std::mem::transmute::<InParallel<'_>, Lent>(in_parallel) };
    let _restore = Restore(LENT.replace(Some(lent)));
    then()
}

pub fn has_helpers() -> bool {
    LENT.get().is_some()
}

pub fn with_helpers<R>(then: impl FnOnce(InParallel<'_>) -> R) -> R {
    match LENT.get() {
        // SAFETY: the `lend_helpers` that has set it is further up this thread's stack.
        Some(lent) => then(unsafe { lent.as_ref() }),
        None => then(&|count, work| (0..count).for_each(work)),
    }
}

/// `bun_alloc::prefault`
#[inline]
pub fn prefault<T: Send>(room: &mut [MaybeUninit<T>]) {
    const AT_A_TIME: usize = 128 << 10;
    if size_of_val(room) < 4 * AT_A_TIME || !cfg!(target_os = "linux") {
        return bun_alloc::prefault(room);
    }
    let parts = room.chunks_mut(AT_A_TIME.div_ceil(size_of::<T>()));
    let parts: Vec<_> = parts.map(Guarded::new).collect();
    let prefault_part = |at: usize| bun_alloc::prefault(&mut **parts[at].lock());
    with_helpers(|in_parallel| in_parallel(parts.len(), &prefault_part));
}
