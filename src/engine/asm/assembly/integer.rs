use crate::label::{Code, CodeTooLarge, Label, Target};
use crate::operand::{
    Address, Amount, AtomicOp, Cond, Memory, RegOrImm, RegOrMem, ResultCond, Shift, Sign, Size,
    Src, TestCond, Width,
};
use crate::register::{Fpr, Gpr, RegisterSet};

#[derive(Clone, Copy, Debug)]
pub struct Options<Features> {
    pub features: Features,
    /// Picks the shortest jumps that reach, at some cost when the code is finished.
    pub shorten_jumps: bool,
    /// Decides which [`crate::Untrusted`] constants are disguised, and how.
    pub seed: u64,
}

/// The registers that macro operations may overwrite.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Scratch {
    pub gprs: [Option<Gpr>; 2],
    pub fprs: [Option<Fpr>; 2],
}

/// How many of the registers of each bank in [`Scratch`] an operation overwrites.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct ScratchNeeds {
    pub gprs: u8,
    pub fprs: u8,
}

pub trait MacroAssembly: Sized {
    type Features: Copy;

    const FRAME_POINTER: Gpr;
    const STACK_POINTER: Gpr;
    const NUMBER_TAG: Gpr;
    const NOT_CELL_MASK: Gpr;
    const ARGUMENT_GPRS: &'static [Gpr];
    const ARGUMENT_FPRS: &'static [Fpr];
    /// Overwritten by `div`, `rem`, `mul_high64` and `mul_wide64`. Their `rhs` is not among them.
    const DIVISION_CLOBBERS: RegisterSet;
    /// Overwritten by the atomic operations that take a `temp`. Only `dst` and `expected` may be among them.
    const ATOMIC_CLOBBERS: RegisterSet;
    /// How far `push` moves the stack pointer.
    const PUSH_SIZE: i32;

    fn new(options: Options<Self::Features>) -> Self;
    fn features(&self) -> Self::Features;
    fn finish(self) -> Result<Code, CodeTooLarge>;
    /// Like `finish`. All that can follow is `restart`.
    fn take_code(&mut self) -> Result<Code, CodeTooLarge>;
    /// Like `new`, but keeps its memory, and takes that of code that is not needed any more.
    fn restart(&mut self, options: Options<Self::Features>, spent: Option<Code>);
    /// The number of bytes so far. It is no place in the finished code.
    fn size(&self) -> usize;
    fn reserve(&mut self, bytes: usize);
    fn scratch(&self) -> Scratch;
    /// Returns what it replaces.
    fn set_scratch(&mut self, scratch: Scratch) -> Scratch;

    // Labels

    fn new_label(&mut self) -> Label;
    fn bind(&mut self, label: Label);
    /// Sends what refers to the unbound `label` to wherever `target` is or will be.
    fn alias(&mut self, label: Label, target: Label);
    fn external(&mut self, target: Target) -> Label;
    /// Names this place for a table. Nothing jumps to it.
    fn mark(&mut self) -> Label;
    /// Pads to a multiple of `alignment` unless that takes more than `max_padding` bytes.
    fn align(&mut self, alignment: u32, max_padding: u32);

    #[inline]
    fn here(&mut self) -> Label {
        let label = self.new_label();
        self.bind(label);
        label
    }

    #[inline]
    fn external_address(&mut self, address: usize) -> Label {
        self.external(Target::Address(address))
    }

    // Control

    fn jump(&mut self, target: Label);
    fn jump_indirect(&mut self, target: impl Into<RegOrMem>);
    /// Goes to `targets[index]`. `index` is in range, has its upper half clear and is overwritten.
    fn jump_table(&mut self, index: Gpr, targets: &[Label]);
    fn call(&mut self, target: Label);
    fn call_indirect(&mut self, target: impl Into<RegOrMem>);
    fn ret(&mut self);
    /// `label` is not external.
    fn move_label_address(&mut self, dst: Gpr, label: Label);
    fn breakpoint(&mut self);
    /// For what cannot be reached. Leaves `reason` where a crash report shows it.
    fn abort(&mut self, reason: u16);
    fn nop(&mut self);

    #[inline]
    fn call_address(&mut self, address: usize) {
        let target = self.external_address(address);
        self.call(target);
    }

    #[inline]
    fn jump_address(&mut self, address: usize) {
        let target = self.external_address(address);
        self.jump(target);
    }

    // Code that changes. See `patch`.

    /// Returns the end of a jump whose target can change while other threads run it.
    fn patchable_jump(&mut self, target: Label) -> Label;
    /// Returns the end of a call whose target can change while other threads run it.
    fn patchable_call(&mut self, target: Label) -> Label;
    /// Returns the end of the instructions.
    fn patchable_move64(&mut self, dst: Gpr, value: u64) -> Label;
    /// A place where a jump can be written over whatever follows.
    fn replaceable_point(&mut self) -> Label;

    // The stack

    /// Saves the caller's frame pointer and the return address, and points the frame pointer at them.
    fn enter_frame(&mut self);
    /// Undoes `enter_frame`, wherever the stack pointer is.
    fn leave_frame(&mut self);
    fn push(&mut self, src: Gpr);
    fn pop(&mut self, dst: Gpr);
    /// Takes 16 bytes, `low` at the lower address.
    fn push_pair(&mut self, low: Gpr, high: Gpr);
    /// The two differ.
    fn pop_pair(&mut self, low: Gpr, high: Gpr);

    // Moves

    fn move_int(&mut self, width: Width, dst: Gpr, src: impl Into<RegOrImm>);
    fn swap(&mut self, a: Gpr, b: Gpr);
    /// Extends the low `from` bits of `src` to `width`.
    fn extend(&mut self, from: Size, sign: Sign, width: Width, dst: Gpr, src: Gpr);
    fn compute_address(&mut self, dst: Gpr, address: Address);

    // Memory

    /// Fills the rest of `dst` with zeros. `dst` may hold part of the address first, so a fault may find it changed.
    fn load(&mut self, size: Size, dst: Gpr, src: impl Into<Memory>);
    fn load_signed(&mut self, size: Size, width: Width, dst: Gpr, src: impl Into<Memory>);
    fn store(&mut self, size: Size, dst: impl Into<Memory>, src: impl Into<RegOrImm>);
    /// `low` from `src`, `high` from the bytes after it. The two differ.
    fn load_pair(&mut self, width: Width, low: Gpr, high: Gpr, src: Address);
    fn store_pair(&mut self, width: Width, dst: Address, low: Gpr, high: Gpr);
    fn transfer(&mut self, size: Size, dst: Address, src: Address);
    /// `*dst += src`, not atomically.
    fn add_to_memory(&mut self, size: Size, dst: impl Into<Memory>, src: impl Into<RegOrImm>);
    fn and_to_memory(&mut self, size: Size, dst: impl Into<Memory>, src: impl Into<RegOrImm>);
    fn or_to_memory(&mut self, size: Size, dst: impl Into<Memory>, src: impl Into<RegOrImm>);
    fn prefetch(&mut self, address: Address);

    // Integers

    fn add(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>);
    fn sub(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>);
    fn mul(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>);
    fn and(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>);
    fn or(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>);
    fn xor(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>);
    fn neg(&mut self, width: Width, dst: Gpr, src: Gpr);
    fn not(&mut self, width: Width, dst: Gpr, src: Gpr);
    fn shift(&mut self, shift: Shift, width: Width, dst: Gpr, src: Gpr, amount: impl Into<Amount>);
    /// `rhs` is not zero and the quotient fits.
    fn div(&mut self, sign: Sign, width: Width, dst: Gpr, lhs: Gpr, rhs: Gpr);
    /// `rhs` is not zero and the quotient fits.
    fn rem(&mut self, sign: Sign, width: Width, dst: Gpr, lhs: Gpr, rhs: Gpr);
    fn mul_high64(&mut self, sign: Sign, dst: Gpr, lhs: Gpr, rhs: Gpr);
    /// `low` and `high` differ.
    fn mul_wide64(&mut self, sign: Sign, low: Gpr, high: Gpr, lhs: Gpr, rhs: Gpr);
    /// Pairs are `[low, high]`. `dst[0]` is neither of the high operands nor `dst[1]`.
    fn add128(&mut self, dst: [Gpr; 2], lhs: [Gpr; 2], rhs: [Gpr; 2]);
    /// Pairs are `[low, high]`. `dst[0]` is neither of the high operands nor `dst[1]`.
    fn sub128(&mut self, dst: [Gpr; 2], lhs: [Gpr; 2], rhs: [Gpr; 2]);
    fn count_leading_zeros(&mut self, width: Width, dst: Gpr, src: Gpr);
    fn count_trailing_zeros(&mut self, width: Width, dst: Gpr, src: Gpr);
    fn count_ones(&mut self, width: Width, dst: Gpr, src: Gpr);
    /// Reverses the low `size` bytes and clears the rest.
    fn swap_bytes(&mut self, size: Size, dst: Gpr, src: Gpr);
    /// The `count` bits of `src` from bit `first` up, extended to `width`.
    fn extract_bits(&mut self, sign: Sign, width: Width, dst: Gpr, src: Gpr, first: u8, count: u8);
    /// `dst = lhs + shift(rhs, amount)`, as by [`Self::shift`]. Not for rotations.
    fn add_shifted(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: Gpr, shift: Shift, amount: u8);
    /// `dst = lhs ^ shift(rhs, amount)`, as by [`Self::shift`].
    fn xor_shifted(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: Gpr, shift: Shift, amount: u8);

    // Comparisons. Arithmetic writes its result, wrapped around, whether it branches or not. A test may leave bytes
    // of memory unread that its mask does not cover.

    fn branch(
        &mut self,
        width: Width,
        cond: Cond,
        lhs: impl Into<RegOrMem>,
        rhs: impl Into<Src>,
        target: Label,
    );
    /// Compares one or two bytes of memory with the low bytes of `rhs`.
    fn branch_narrow(
        &mut self,
        size: Size,
        cond: Cond,
        lhs: impl Into<Memory>,
        rhs: i32,
        target: Label,
    );
    fn branch_test(
        &mut self,
        width: Width,
        cond: TestCond,
        value: impl Into<RegOrMem>,
        mask: impl Into<RegOrImm>,
        target: Label,
    );
    /// Tests one or two bytes of memory against the low bytes of `mask`.
    fn branch_test_narrow(
        &mut self,
        size: Size,
        cond: TestCond,
        value: impl Into<Memory>,
        mask: i32,
        target: Label,
    );
    /// `cond` is `Zero` or `NonZero`.
    fn branch_test_bit(
        &mut self,
        width: Width,
        cond: TestCond,
        value: Gpr,
        bit: impl Into<Amount>,
        target: Label,
    );
    fn branch_add(
        &mut self,
        width: Width,
        cond: ResultCond,
        dst: Gpr,
        lhs: Gpr,
        rhs: impl Into<Src>,
        target: Label,
    );
    fn branch_sub(
        &mut self,
        width: Width,
        cond: ResultCond,
        dst: Gpr,
        lhs: Gpr,
        rhs: impl Into<Src>,
        target: Label,
    );
    /// Branches when the signed product does not fit.
    fn branch_mul_overflow(
        &mut self,
        width: Width,
        dst: Gpr,
        lhs: Gpr,
        rhs: impl Into<Src>,
        target: Label,
    );
    /// `cond` is not about the carry.
    fn branch_neg(&mut self, width: Width, cond: ResultCond, dst: Gpr, src: Gpr, target: Label);
    fn branch_add_to_memory(
        &mut self,
        width: Width,
        cond: ResultCond,
        dst: impl Into<Memory>,
        src: i32,
        target: Label,
    );
    /// `dst` becomes 0 or 1.
    fn compare(
        &mut self,
        width: Width,
        cond: Cond,
        dst: Gpr,
        lhs: impl Into<RegOrMem>,
        rhs: impl Into<Src>,
    );
    /// `dst` becomes 0 or 1.
    fn compare_narrow(
        &mut self,
        size: Size,
        cond: Cond,
        dst: Gpr,
        lhs: impl Into<Memory>,
        rhs: i32,
    );
    /// `dst` becomes 0 or 1.
    fn test(
        &mut self,
        width: Width,
        cond: TestCond,
        dst: Gpr,
        value: impl Into<RegOrMem>,
        mask: impl Into<RegOrImm>,
    );
    /// `dst` becomes 0 or 1.
    fn test_narrow(
        &mut self,
        size: Size,
        cond: TestCond,
        dst: Gpr,
        value: impl Into<Memory>,
        mask: i32,
    );
    /// Moves all 64 bits. `width` is that of the comparison.
    fn select(
        &mut self,
        width: Width,
        cond: Cond,
        dst: Gpr,
        lhs: Gpr,
        rhs: impl Into<RegOrImm>,
        then: Gpr,
        or: Gpr,
    );
    fn select_test(
        &mut self,
        width: Width,
        cond: TestCond,
        dst: Gpr,
        value: Gpr,
        mask: impl Into<RegOrImm>,
        then: Gpr,
        or: Gpr,
    );

    // Atomics, sequentially consistent, on aligned memory. Results are extended with zeros.

    fn atomic_load(&mut self, size: Size, dst: Gpr, src: Address);
    fn atomic_store(&mut self, size: Size, dst: Address, src: Gpr);
    /// `dst` gets the old value. `dst` and `temp` differ from each other and from the other operands.
    fn atomic_update(
        &mut self,
        op: AtomicOp,
        size: Size,
        dst: Gpr,
        address: Address,
        operand: Gpr,
        temp: Gpr,
    );
    /// `dst` gets the old value and may be `expected`, of which the low `size` bytes count. Otherwise `dst` and `temp`
    /// differ from each other and from the other operands.
    fn atomic_compare_exchange(
        &mut self,
        size: Size,
        dst: Gpr,
        address: Address,
        expected: Gpr,
        replacement: Gpr,
        temp: Gpr,
    );
    fn memory_fence(&mut self);
    /// Orders earlier stores before later stores.
    fn store_fence(&mut self);
    /// Orders earlier loads before later loads and stores.
    fn load_fence(&mut self);

    for_both! { Width::W32, Width::W64;
        move_int as move32, move64(dst: Gpr, src: impl Into<RegOrImm>);
        load_pair as load_pair32, load_pair64(low: Gpr, high: Gpr, src: Address);
        store_pair as store_pair32, store_pair64(dst: Address, low: Gpr, high: Gpr);
        add as add32, add64(dst: Gpr, lhs: Gpr, rhs: impl Into<Src>);
        sub as sub32, sub64(dst: Gpr, lhs: Gpr, rhs: impl Into<Src>);
        mul as mul32, mul64(dst: Gpr, lhs: Gpr, rhs: impl Into<Src>);
        and as and32, and64(dst: Gpr, lhs: Gpr, rhs: impl Into<Src>);
        or as or32, or64(dst: Gpr, lhs: Gpr, rhs: impl Into<Src>);
        xor as xor32, xor64(dst: Gpr, lhs: Gpr, rhs: impl Into<Src>);
        neg as neg32, neg64(dst: Gpr, src: Gpr);
        not as not32, not64(dst: Gpr, src: Gpr);
        count_leading_zeros as count_leading_zeros32, count_leading_zeros64(dst: Gpr, src: Gpr);
        count_trailing_zeros as count_trailing_zeros32, count_trailing_zeros64(dst: Gpr, src: Gpr);
        count_ones as count_ones32, count_ones64(dst: Gpr, src: Gpr);
        branch as branch32, branch64(cond: Cond, lhs: impl Into<RegOrMem>, rhs: impl Into<Src>, target: Label);
        branch_test as branch_test32, branch_test64(
            cond: TestCond, value: impl Into<RegOrMem>, mask: impl Into<RegOrImm>, target: Label
        );
        branch_test_bit as branch_test_bit32, branch_test_bit64(
            cond: TestCond, value: Gpr, bit: impl Into<Amount>, target: Label
        );
        branch_add as branch_add32, branch_add64(
            cond: ResultCond, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>, target: Label
        );
        branch_sub as branch_sub32, branch_sub64(
            cond: ResultCond, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>, target: Label
        );
        branch_mul_overflow as branch_mul32_overflow, branch_mul64_overflow(
            dst: Gpr, lhs: Gpr, rhs: impl Into<Src>, target: Label
        );
        branch_neg as branch_neg32, branch_neg64(cond: ResultCond, dst: Gpr, src: Gpr, target: Label);
        branch_add_to_memory as branch_add32_to_memory, branch_add64_to_memory(
            cond: ResultCond, dst: impl Into<Memory>, src: i32, target: Label
        );
        compare as compare32, compare64(cond: Cond, dst: Gpr, lhs: impl Into<RegOrMem>, rhs: impl Into<Src>);
        test as test32, test64(cond: TestCond, dst: Gpr, value: impl Into<RegOrMem>, mask: impl Into<RegOrImm>);
        select as select32, select64(cond: Cond, dst: Gpr, lhs: Gpr, rhs: impl Into<RegOrImm>, then: Gpr, or: Gpr);
        select_test as select_test32, select_test64(
            cond: TestCond, dst: Gpr, value: Gpr, mask: impl Into<RegOrImm>, then: Gpr, or: Gpr
        );
    }

    for_both_after! { Width::W32, Width::W64;
        shift(Shift::Left) as shl32, shl64(dst: Gpr, src: Gpr, amount: impl Into<Amount>);
        shift(Shift::RightLogical) as shr32, shr64(dst: Gpr, src: Gpr, amount: impl Into<Amount>);
        shift(Shift::RightArithmetic) as sar32, sar64(dst: Gpr, src: Gpr, amount: impl Into<Amount>);
        shift(Shift::RotateLeft) as rotl32, rotl64(dst: Gpr, src: Gpr, amount: impl Into<Amount>);
        shift(Shift::RotateRight) as rotr32, rotr64(dst: Gpr, src: Gpr, amount: impl Into<Amount>);
        load_signed(Size::S8) as load8_signed32, load8_signed64(dst: Gpr, src: impl Into<Memory>);
        load_signed(Size::S16) as load16_signed32, load16_signed64(dst: Gpr, src: impl Into<Memory>);
    }

    for_both! { Size::S8, Size::S16;
        load as load8, load16(dst: Gpr, src: impl Into<Memory>);
        store as store8, store16(dst: impl Into<Memory>, src: impl Into<RegOrImm>);
        branch_narrow as branch8, branch16(cond: Cond, lhs: impl Into<Memory>, rhs: i32, target: Label);
        branch_test_narrow as branch_test8, branch_test16(
            cond: TestCond, value: impl Into<Memory>, mask: i32, target: Label
        );
        compare_narrow as compare8, compare16(cond: Cond, dst: Gpr, lhs: impl Into<Memory>, rhs: i32);
        test_narrow as test8, test16(cond: TestCond, dst: Gpr, value: impl Into<Memory>, mask: i32);
    }

    for_both! { Size::S32, Size::S64;
        load as load32, load64(dst: Gpr, src: impl Into<Memory>);
        store as store32, store64(dst: impl Into<Memory>, src: impl Into<RegOrImm>);
        transfer as transfer32, transfer64(dst: Address, src: Address);
        add_to_memory as add32_to_memory, add64_to_memory(dst: impl Into<Memory>, src: impl Into<RegOrImm>);
    }

    aliases! {
        load_signed(Size::S32, Width::W64) as load32_signed64(dst: Gpr, src: impl Into<Memory>);
        extend(Size::S8, Sign::Unsigned, Width::W32) as zero_extend8(dst: Gpr, src: Gpr);
        extend(Size::S16, Sign::Unsigned, Width::W32) as zero_extend16(dst: Gpr, src: Gpr);
        extend(Size::S32, Sign::Unsigned, Width::W64) as zero_extend32(dst: Gpr, src: Gpr);
        extend(Size::S8, Sign::Signed, Width::W32) as sign_extend8_to_32(dst: Gpr, src: Gpr);
        extend(Size::S16, Sign::Signed, Width::W32) as sign_extend16_to_32(dst: Gpr, src: Gpr);
        extend(Size::S32, Sign::Signed, Width::W64) as sign_extend32_to_64(dst: Gpr, src: Gpr);
    }

    #[inline]
    fn branch_if_zero32(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch_test32(TestCond::Zero, value, -1, target);
    }

    #[inline]
    fn branch_if_not_zero32(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch_test32(TestCond::NonZero, value, -1, target);
    }

    #[inline]
    fn branch_if_zero64(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch_test64(TestCond::Zero, value, -1, target);
    }

    #[inline]
    fn branch_if_not_zero64(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch_test64(TestCond::NonZero, value, -1, target);
    }
}
