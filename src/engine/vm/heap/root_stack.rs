use core::marker::PhantomData;
use core::mem::{MaybeUninit, needs_drop};
use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;

use bun_alloc::AllocError;

use super::{RootVec, root_vec};

/// A stack for a local variable. It allocates nothing while it fits in the room that it is lent, which is another one.
pub struct RootStack<'a, T> {
    /// In what is lent or in `spilled`. The first `length` are written.
    slots: NonNull<T>,
    length: usize,
    capacity: usize,
    /// Only the capacity is used.
    spilled: RootVec<T>,
    lent: PhantomData<&'a mut [T]>,
}

impl<'a, T> RootStack<'a, T> {
    #[inline(always)]
    pub fn new<const N: usize>(room: &'a mut [MaybeUninit<T>; N]) -> RootStack<'a, T> {
        const { assert!(N > 0 && !needs_drop::<T>()) };
        RootStack {
            slots: NonNull::from_mut(room).cast(),
            length: 0,
            capacity: N,
            spilled: root_vec(),
            lent: PhantomData,
        }
    }

    /// Ends the process if there is no memory.
    #[inline(always)]
    pub(crate) fn push(&mut self, value: T) {
        if self.try_push(value).is_err() {
            bun_alloc::out_of_memory();
        }
    }

    #[inline(always)]
    pub fn try_push(&mut self, value: T) -> Result<(), AllocError> {
        if self.length == self.capacity {
            self.grow()?;
        }
        // SAFETY: below the capacity.
        unsafe { self.slots.add(self.length).write(value) };
        self.length += 1;
        Ok(())
    }

    #[cold]
    #[inline(never)]
    extern "rust-cold" fn grow(&mut self) -> Result<(), AllocError> {
        let mut larger = root_vec();
        (larger.try_reserve_exact(4 * self.capacity)).map_err(|_| AllocError)?;
        let slots = NonNull::from_mut(larger.spare_capacity_mut()).cast();
        // SAFETY: a new allocation that is larger.
        unsafe { self.slots.copy_to_nonoverlapping(slots, self.length) };
        (self.slots, self.capacity) = (slots, larger.capacity());
        self.spilled = larger;
        Ok(())
    }

    #[inline(always)]
    pub(crate) fn pop(&mut self) -> Option<T> {
        self.length = self.length.checked_sub(1)?;
        // SAFETY: written.
        Some(unsafe { self.slots.add(self.length).read() })
    }
}

impl<T> Deref for RootStack<'_, T> {
    type Target = [T];

    #[inline(always)]
    fn deref(&self) -> &[T] {
        // SAFETY: written.
        unsafe { NonNull::slice_from_raw_parts(self.slots, self.length).as_ref() }
    }
}

impl<T> DerefMut for RootStack<'_, T> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut [T] {
        // SAFETY: as above.
        unsafe { NonNull::slice_from_raw_parts(self.slots, self.length).as_mut() }
    }
}
