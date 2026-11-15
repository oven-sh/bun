use core::cell::Cell;
use core::ptr::NonNull;

use bun_ptr::RefPtr;

/// The bytes that a subprocess may still write to its stdout or stderr pipe.
#[derive(bun_ptr::CellRefCounted)]
pub struct MaxBuf {
    ref_count: Cell<u32>,
    kind: Kind,
    /// Not the reader's parent, which is a `FileReader` once script has asked for the stream.
    owner: Cell<Option<Owner>>,
    remaining_bytes: Cell<i64>,
}

/// The `Subprocess`, and how it is told that the budget is gone.
#[derive(Copy, Clone)]
pub struct Owner {
    pub ptr: NonNull<()>,
    pub on_overflow: unsafe fn(NonNull<()>, Kind),
}

/// How far the read that crosses `maxBuffer` may overshoot it: one Node-sized
/// stdio read. Must stay nonzero, Node's `spawnSync` documents `stdout`
/// exceeding `maxBuffer` by up to one read.
const OVERREAD_ALLOWANCE: u64 = 64 * 1024;

/// The owner's ref. The owner is not called once this is dropped.
pub struct OwnerRef(RefPtr<MaxBuf>);

impl OwnerRef {
    /// SAFETY: `owner.on_overflow` can be called with `owner.ptr` until the returned ref is dropped.
    pub unsafe fn new(bytes: i64, kind: Kind, owner: Owner) -> OwnerRef {
        OwnerRef(RefPtr::new(MaxBuf {
            ref_count: Cell::new(1),
            kind,
            owner: Cell::new(Some(owner)),
            remaining_bytes: Cell::new(bytes),
        }))
    }

    pub fn for_reader(&self) -> RefPtr<MaxBuf> {
        self.0.clone()
    }
}

impl Drop for OwnerRef {
    fn drop(&mut self) {
        self.0.owner.set(None);
    }
}

impl MaxBuf {
    /// `true` if the budget is gone and the owner has just been told, which happens once.
    pub(crate) fn on_read_bytes(&self, bytes: u64) -> bool {
        let delta = i64::try_from(bytes).unwrap_or(0);
        let remaining = self.remaining_bytes.get().checked_sub(delta).unwrap_or(-1);
        self.remaining_bytes.set(remaining);
        if remaining >= 0 {
            return false;
        }
        let Some(owner) = self.owner.take() else {
            return false;
        };
        // SAFETY: `OwnerRef::new`'s contract. Its drop would have cleared `self.owner`.
        unsafe { (owner.on_overflow)(owner.ptr, self.kind) };
        true
    }

    /// Trims `buf` to the remaining budget plus `OVERREAD_ALLOWANCE`: unclamped,
    /// a 256 KB scratch read off a socketpair overshoots `maxBuffer` by hundreds
    /// of KB. Never empties a non-empty `buf` (that would read as EOF).
    pub(crate) fn clamp_read_buf<'a>(this: Option<&MaxBuf>, buf: &'a mut [u8]) -> &'a mut [u8] {
        let Some(this) = this else {
            return buf;
        };
        let remaining = u64::try_from(this.remaining_bytes.get()).unwrap_or(0);
        let limit =
            usize::try_from(remaining.saturating_add(OVERREAD_ALLOWANCE)).unwrap_or(usize::MAX);
        let len = buf.len().min(limit);
        &mut buf[..len]
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Kind {
    Stdout,
    Stderr,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn budget(bytes: i64, overflows: &Cell<u32>) -> OwnerRef {
        unsafe fn count(overflows: NonNull<()>, _: Kind) {
            // SAFETY: the cell that `budget` was given.
            unsafe { overflows.cast::<Cell<u32>>().as_ref() }.update(|n| n + 1);
        }
        let owner = Owner {
            ptr: NonNull::from(overflows).cast(),
            on_overflow: count,
        };
        // SAFETY: every test declares the cell first.
        unsafe { OwnerRef::new(bytes, Kind::Stdout, owner) }
    }

    #[test]
    fn two_readers_outlive_the_owner() {
        let overflows = Cell::new(0);
        let owner = budget(1, &overflows);
        let (a, b) = (owner.for_reader(), owner.for_reader());
        drop(owner);
        drop(a);
        assert!(!b.on_read_bytes(2));
        assert_eq!(overflows.get(), 0);
    }

    #[test]
    fn two_readers_share_the_budget_and_overflow_once() {
        let overflows = Cell::new(0);
        let owner = budget(1, &overflows);
        let (a, b) = (owner.for_reader(), owner.for_reader());
        assert!(!a.on_read_bytes(1));
        assert!(b.on_read_bytes(1));
        assert!(!a.on_read_bytes(1));
        drop((a, b));
        assert_eq!(overflows.get(), 1);
    }
}
