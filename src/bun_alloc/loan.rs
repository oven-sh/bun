//! Lets code that builds its result in a `Vec` build it in memory that the caller already has.

use core::alloc::{AllocError, Allocator, Layout};
use core::cell::Cell;
use core::marker::PhantomData;
use core::mem::MaybeUninit;
use core::ptr::NonNull;
use std::alloc::Global;

/// Memory that one allocation at a time can have.
pub struct Loan<'a> {
    memory: NonNull<[u8]>,
    is_out: Cell<bool>,
    borrow: PhantomData<&'a mut [MaybeUninit<u8>]>,
}

impl<'a> Loan<'a> {
    pub fn new(memory: &'a mut [MaybeUninit<u8>]) -> Self {
        let len = memory.len();
        Self {
            memory: NonNull::slice_from_raw_parts(NonNull::from_mut(memory).cast(), len),
            is_out: Cell::new(false),
            borrow: PhantomData,
        }
    }

    pub fn lender(&self) -> Lender<'_> {
        Lender(Some(self))
    }
}

/// The global allocator, but for a request that is exactly as large as the loan.
#[derive(Clone, Copy)]
pub struct Lender<'a>(Option<&'a Loan<'a>>);

impl<'a> Lender<'a> {
    pub const NONE: Lender<'static> = Lender(None);

    /// Whether a request for `size` bytes that need no alignment gets the loan.
    pub fn lends(self, size: usize) -> bool {
        self.0
            .is_some_and(|loan| size != 0 && size == loan.memory.len() && !loan.is_out.get())
    }

    fn loan_at(self, address: *const u8) -> Option<&'a Loan<'a>> {
        self.0
            .filter(|loan| loan.is_out.get() && address == loan.memory.as_ptr().cast())
    }

    /// `None` if `vec` is in the loan, which then holds what `vec` did.
    pub fn release(vec: Vec<u8, Self>) -> Option<Vec<u8>> {
        if vec.allocator().loan_at(vec.as_ptr()).is_some() {
            return None;
        }
        let (address, len, capacity, _) = vec.into_raw_parts_with_allocator();
        // SAFETY: what is not the loan came from `Global`.
        Some(unsafe { Vec::from_raw_parts(address, len, capacity) })
    }

    /// `vec![0; len]`
    pub fn zeroed(self, len: usize) -> Vec<u8, Self> {
        // SAFETY: zero is a `u8`.
        unsafe { Box::new_zeroed_slice_in(len, self).assume_init() }.into_vec()
    }

    pub fn adopt(vec: Vec<u8>) -> Vec<u8, Lender<'static>> {
        let (address, len, capacity) = vec.into_raw_parts();
        // SAFETY: `NONE` is `Global`.
        unsafe { Vec::from_raw_parts_in(address, len, capacity, Lender::NONE) }
    }

    /// # Safety
    /// As for `Allocator::grow()` or `Allocator::shrink()`, and `address` is that of `loan`.
    unsafe fn move_out(
        loan: &Loan,
        address: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        let moved = Global.allocate(new)?;
        // SAFETY: both have room for the smaller size, and `moved` is new.
        unsafe { address.copy_to_nonoverlapping(moved.cast(), old.size().min(new.size())) };
        loan.is_out.set(false);
        Ok(moved)
    }
}

// SAFETY: `is_out` keeps the loan from being handed out twice, the lifetime keeps it valid and where it is, and copies
// of a `Lender` share it. The rest is left to `Global`, none of whose blocks is at the address of the loan.
unsafe impl Allocator for Lender<'_> {
    #[inline]
    fn allocate(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        match self.0 {
            Some(loan)
                if self.lends(layout.size())
                    && loan.memory.addr().get().is_multiple_of(layout.align()) =>
            {
                loan.is_out.set(true);
                Ok(loan.memory)
            }
            _ => Global.allocate(layout),
        }
    }

    fn allocate_zeroed(&self, layout: Layout) -> Result<NonNull<[u8]>, AllocError> {
        if !self.lends(layout.size()) {
            return Global.allocate_zeroed(layout);
        }
        let memory = self.allocate(layout)?;
        // SAFETY: `allocate()` has just handed it out.
        unsafe { memory.cast::<u8>().write_bytes(0, memory.len()) };
        Ok(memory)
    }

    #[inline]
    unsafe fn deallocate(&self, address: NonNull<u8>, layout: Layout) {
        match self.loan_at(address.as_ptr()) {
            Some(loan) => loan.is_out.set(false),
            // SAFETY: the caller's promises are passed on.
            None => unsafe { Global.deallocate(address, layout) },
        }
    }

    unsafe fn grow(
        &self,
        address: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // SAFETY: as above.
        unsafe {
            match self.loan_at(address.as_ptr()) {
                Some(loan) => Self::move_out(loan, address, old, new),
                None => Global.grow(address, old, new),
            }
        }
    }

    unsafe fn shrink(
        &self,
        address: NonNull<u8>,
        old: Layout,
        new: Layout,
    ) -> Result<NonNull<[u8]>, AllocError> {
        // SAFETY: as above.
        unsafe {
            match self.loan_at(address.as_ptr()) {
                Some(loan) => Self::move_out(loan, address, old, new),
                None => Global.shrink(address, old, new),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lend(run: impl FnOnce(Lender)) -> [u8; 8] {
        let mut memory = [MaybeUninit::new(7); 8];
        run(Loan::new(&mut memory).lender());
        // SAFETY: the tests write no uninitialized byte.
        memory.map(|it| unsafe { it.assume_init() })
    }

    fn filled(value: u8, len: usize, lender: Lender) -> Vec<u8, Lender> {
        let mut vec = Vec::with_capacity_in(len, lender);
        vec.resize(len, value);
        vec
    }

    #[test]
    fn only_the_exact_size_is_lent() {
        for len in [0, 7, 9] {
            let memory = lend(|lender| {
                assert!(!lender.lends(len));
                assert_eq!(Lender::release(filled(1, len, lender)), Some(vec![1; len]));
                assert_eq!(Lender::release(lender.zeroed(len)), Some(vec![0; len]));
            });
            assert_eq!(memory, [7; 8]);
        }
        let memory = lend(|lender| assert_eq!(Lender::release(filled(1, 8, lender)), None));
        assert_eq!(memory, [1; 8]);
        let memory = lend(|lender| assert_eq!(Lender::release(lender.zeroed(8)), None));
        assert_eq!(memory, [0; 8]);
    }

    #[test]
    fn nothing_is_lent_twice_at_a_time() {
        let memory = lend(|lender| {
            let first = filled(1, 8, lender);
            assert!(!lender.lends(8));
            assert_eq!(Lender::release(filled(2, 8, lender)), Some(vec![2; 8]));
            assert_eq!(first, [1; 8]);
            drop(first);
            assert_eq!(Lender::release(filled(3, 8, lender)), None);
        });
        assert_eq!(memory, [3; 8]);
    }

    #[test]
    fn what_changes_its_size_moves_out() {
        let memory = lend(|lender| {
            let mut grown = filled(1, 8, lender);
            grown.push(2);
            let mut shrunk = filled(3, 8, lender);
            shrunk.truncate(2);
            shrunk.shrink_to_fit();
            assert!(lender.lends(8));
            grown.extend([2; 40]);
            grown.truncate(9);
            grown.shrink_to_fit();
            assert_eq!(
                Lender::release(grown),
                Some(vec![1, 1, 1, 1, 1, 1, 1, 1, 2])
            );
            assert_eq!(Lender::release(shrunk), Some(vec![3, 3]));
        });
        assert_eq!(memory, [3; 8]);
    }

    #[test]
    fn what_is_lent_is_aligned() {
        let mut memory = [MaybeUninit::new(7); 9];
        let odd = (memory.as_ptr().addr() + 1) % 2;
        let loan = Loan::new(&mut memory[odd..odd + 8]);
        let vec = Vec::<u16, _>::with_capacity_in(4, loan.lender());
        assert!(vec.as_ptr().is_aligned() && loan.lender().lends(8));
        // SAFETY: zero is a `u16`.
        let zeroed =
            unsafe { Box::<[u16], _>::new_zeroed_slice_in(4, loan.lender()).assume_init() };
        assert_eq!(*zeroed, [0; 4]);
    }

    #[test]
    fn an_adopted_vec_is_like_any_other() {
        let mut vec = Lender::adopt(vec![1, 2]);
        vec.extend([3; 30]);
        vec.truncate(3);
        assert_eq!(Lender::release(vec), Some(vec![1, 2, 3]));
        drop(Lender::adopt(vec![1]));
    }
}
