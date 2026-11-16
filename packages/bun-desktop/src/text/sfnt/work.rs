//! Offsets and counts can make a small font take forever.

use std::cell::Cell;

thread_local! {
    static LEFT: Cell<Option<usize>> = const { Cell::new(None) };
}

struct Outermost;

impl Drop for Outermost {
    fn drop(&mut self) {
        LEFT.set(None);
    }
}

/// An enclosing limit goes on counting instead.
pub fn limited<T>(limit: usize, work: impl FnOnce() -> T) -> T {
    let _outermost = LEFT
        .get()
        .is_none()
        .then(|| LEFT.set(Some(limit)))
        .map(|()| Outermost);
    work()
}

/// `None` from when it is too much.
pub fn spend(amount: usize) -> Option<()> {
    let Some(left) = LEFT.get() else {
        return Some(());
    };
    LEFT.set(Some(left.saturating_sub(amount)));
    (left > amount).then_some(())
}
