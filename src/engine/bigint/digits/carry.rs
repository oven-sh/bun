//! Steps of a run of additions or subtractions, in the forms that compile to one instruction each.

/// Unlike `u64::carrying_add`, no AArch64 target turns this into a branch on the carry.
#[inline(always)]
pub(crate) fn add_with_carry(a: u64, b: u64, carry: bool) -> (u64, bool) {
    let (partial, carry) = (a.wrapping_add(b), u64::from(carry));
    let sum = partial.wrapping_add(carry);
    (sum, (partial < a) | (sum < carry))
}

/// The value of the flag after a subtraction that did not borrow: x86 sets it for a borrow, AArch64 for none.
pub(crate) const NO_BORROW: bool = !cfg!(target_arch = "x86_64");

/// `flag` and the flag returned are [`NO_BORROW`] or its opposite.
#[inline(always)]
pub(crate) fn subtract_with_flag(a: u64, b: u64, flag: bool) -> (u64, bool) {
    if NO_BORROW {
        add_with_carry(a, !b, flag)
    } else {
        a.borrowing_sub(b, flag)
    }
}
