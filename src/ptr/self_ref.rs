//! [`SelfRef`]: the ref an intrusively ref-counted object holds on itself.

use core::cell::Cell;
use core::marker::PhantomData;

use crate::{AnyRefCounted, RefPtr, ThisPtr};

/// The ref a ref-counted `T` holds on itself while a timer heap or a queue points at it. One byte, a plain field of that `T`.
pub struct SelfRef<T: AnyRefCounted> {
    held: Cell<bool>,
    _owner: PhantomData<*const T>,
}

/// Panics unless the `slot_size` bytes at `slot` lie inside the `owner_size` bytes at `owner`.
#[inline]
fn assert_field_of(slot: usize, slot_size: usize, owner: usize, owner_size: usize) {
    let offset = slot.wrapping_sub(owner);
    assert!(
        offset.saturating_add(slot_size) <= owner_size,
        "SelfRef: slot is not a field of its owner"
    );
}

impl<T: AnyRefCounted> SelfRef<T> {
    #[inline]
    pub const fn new() -> Self {
        Self {
            held: Cell::new(false),
            _owner: PhantomData,
        }
    }

    #[inline]
    pub fn is_held(&self) -> bool {
        self.held.get()
    }

    /// `slot(owner)`. Panics unless that is a field of `*owner`.
    #[inline]
    fn field_of(owner: &ThisPtr<T>, slot: fn(&T) -> &Self) -> &Self {
        let slot = slot(owner.get());
        assert_field_of(
            core::ptr::from_ref(slot).addr(),
            core::mem::size_of::<Self>(),
            owner.as_ptr().addr(),
            core::mem::size_of::<T>(),
        );
        slot
    }

    /// Takes one ref on `owner`, unless `slot` holds one already. Panics unless `slot` gives a field of `*owner`.
    #[inline]
    pub fn hold(owner: ThisPtr<T>, slot: fn(&T) -> &Self) {
        let slot = Self::field_of(&owner, slot);
        if !slot.is_held() {
            // `take` adopts it.
            let _ = RefPtr::from_this(owner).into_raw();
            slot.held.set(true);
        }
    }

    /// Gives the ref back for the caller to drop, which can free `owner`. Panics as `hold` does.
    #[inline]
    pub fn take(owner: ThisPtr<T>, slot: fn(&T) -> &Self) -> Option<RefPtr<T>> {
        if !Self::field_of(&owner, slot).held.replace(false) {
            return None;
        }
        // SAFETY: only `hold` sets `held`, after it leaks one ref on the `T` that
        // the flag is a field of (asserted there). The flag stays in that `T`:
        // `slot` lends it from `&T`, so it is behind no `RefCell` or lock that
        // gives a `&mut` to it, and `ThisPtr` and `RefPtr` give none to the `T`.
        // It is a field of `*owner` (asserted above), so the leaked ref is on
        // `*owner` and kept it live. We cleared the flag, so the ref is ours.
        Some(unsafe { RefPtr::from_raw(owner.as_ptr()) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BackRef, RefCount, RefCounted};
    use std::rc::Rc;

    struct Owner {
        ref_count: RefCount<Owner>,
        self_ref: SelfRef<Owner>,
        peer: Option<BackRef<Owner>>,
        drops: Rc<Cell<u32>>,
    }

    impl Owner {
        fn new(drops: &Rc<Cell<u32>>, peer: Option<&Owner>) -> RefPtr<Owner> {
            RefPtr::new(Owner {
                ref_count: RefCount::init(),
                self_ref: SelfRef::new(),
                peer: peer.map(BackRef::new),
                drops: Rc::clone(drops),
            })
        }

        fn self_ref(&self) -> &SelfRef<Owner> {
            &self.self_ref
        }

        /// The slot of another `Owner`: what `hold` and `take` must refuse.
        fn peer_self_ref(&self) -> &SelfRef<Owner> {
            &self.peer.as_ref().expect("a peer").get().self_ref
        }

        fn refs(&self) -> u32 {
            self.ref_count.get()
        }
    }

    impl Drop for Owner {
        fn drop(&mut self) {
            self.drops.set(self.drops.get() + 1);
        }
    }

    impl RefCounted for Owner {
        unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
            // SAFETY: the caller gives a pointer in bounds of an `Owner`. This projects a field and reads nothing.
            unsafe { &raw mut (*this).ref_count }
        }
        unsafe fn destructor(this: *mut Self) {
            // SAFETY: the count is zero, so the caller is the one owner of the `Box` that `RefPtr::new` made.
            drop(unsafe { bun_core::heap::take(this) });
        }
    }

    /// Releases the held ref when a test unwinds, so that Miri sees no leak.
    struct ReleaseOnDrop(ThisPtr<Owner>);

    impl Drop for ReleaseOnDrop {
        fn drop(&mut self) {
            drop(SelfRef::take(self.0, Owner::self_ref));
        }
    }

    #[test]
    fn hold_takes_one_ref_and_take_gives_it_back() {
        let drops = Rc::new(Cell::new(0));
        let owner = Owner::new(&drops, None);
        assert!(!owner.self_ref.is_held());

        SelfRef::hold(owner.this_ptr(), Owner::self_ref);
        assert!(owner.self_ref.is_held());
        assert_eq!(owner.refs(), 2);

        let held = SelfRef::take(owner.this_ptr(), Owner::self_ref).expect("the held ref");
        assert!(!owner.self_ref.is_held());
        assert_eq!(held.as_ptr(), owner.as_ptr());
        // The ref moved into `held`; nothing released it yet.
        assert_eq!(owner.refs(), 2);
        drop(held);
        assert_eq!(owner.refs(), 1);

        drop(owner);
        assert_eq!(drops.get(), 1);
    }

    #[test]
    fn take_when_not_held_gives_nothing() {
        let drops = Rc::new(Cell::new(0));
        let owner = Owner::new(&drops, None);

        assert!(SelfRef::take(owner.this_ptr(), Owner::self_ref).is_none());
        assert_eq!(owner.refs(), 1);

        drop(owner);
        assert_eq!(drops.get(), 1);
    }

    #[test]
    fn hold_twice_holds_one_ref() {
        let drops = Rc::new(Cell::new(0));
        let owner = Owner::new(&drops, None);

        SelfRef::hold(owner.this_ptr(), Owner::self_ref);
        SelfRef::hold(owner.this_ptr(), Owner::self_ref);
        assert_eq!(owner.refs(), 2);

        drop(SelfRef::take(owner.this_ptr(), Owner::self_ref).expect("the held ref"));
        assert_eq!(owner.refs(), 1);
        assert!(SelfRef::take(owner.this_ptr(), Owner::self_ref).is_none());
        assert_eq!(owner.refs(), 1);

        drop(owner);
        assert_eq!(drops.get(), 1);
    }

    #[test]
    fn held_ref_keeps_the_owner_alive_until_it_is_dropped() {
        let drops = Rc::new(Cell::new(0));
        let owner = Owner::new(&drops, None);
        let this = owner.this_ptr();

        SelfRef::hold(this, Owner::self_ref);
        drop(owner);
        assert_eq!(drops.get(), 0);
        assert_eq!(this.refs(), 1);

        let held = SelfRef::take(this, Owner::self_ref).expect("the held ref");
        assert_eq!(drops.get(), 0);
        // The last ref: this frees the `Owner`.
        drop(held);
        assert_eq!(drops.get(), 1);
    }

    #[test]
    #[should_panic(expected = "SelfRef: slot is not a field of its owner")]
    fn take_with_the_wrong_owner_panics() {
        let drops = Rc::new(Cell::new(0));
        let holder = Owner::new(&drops, None);
        let other = Owner::new(&drops, Some(&holder));
        SelfRef::hold(holder.this_ptr(), Owner::self_ref);
        let _release = ReleaseOnDrop(holder.this_ptr());

        // `other` would hand out a ref that was taken on `holder`.
        let _ = SelfRef::take(other.this_ptr(), Owner::peer_self_ref);
    }

    #[test]
    #[should_panic(expected = "SelfRef: slot is not a field of its owner")]
    fn hold_with_the_wrong_owner_panics() {
        let drops = Rc::new(Cell::new(0));
        let holder = Owner::new(&drops, None);
        let other = Owner::new(&drops, Some(&holder));

        // The flag of `holder` would stand for a ref on `other`.
        SelfRef::hold(other.this_ptr(), Owner::peer_self_ref);
    }
}
