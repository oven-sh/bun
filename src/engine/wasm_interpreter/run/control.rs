//! Jumps and returns.

use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_runtime::{Failure, Outcome};

use crate::machine::{Handler, Number, attempt, fail, given, handlers, specialize};

/// To the instruction after the record with that index.
macro_rules! jump {
    ($m:ident, $target:expr, $is_backward:expr) => {{
        let (ops, target) = ($m.frame.ops.get(), $target as usize);
        if $is_backward && $m.cx.must_check($m.frame) {
            core::hint::cold_path();
            let link = $crate::machine::given!($crate::code::Pc::at(ops, target));
            $crate::machine::go!($m, $crate::run::control::check, link);
        }
        let (link, pc) = $crate::machine::given!($crate::code::Pc::after(ops, target));
        $crate::machine::go!($m, link.next, pc);
    }};
}

pub(crate) use jump;

handlers! {
    /// After the last instruction.
    #[cold]
    fn nowhere(_m) {
        fail!(Failure::BROKEN);
    }

    #[cold]
    fn unreachable(_m) {
        fail!(Trap::Unreachable);
    }

    /// In place of what a jump or a call leads to, with the record before that.
    #[cold]
    fn check(m, _link) {
        m.keep_frame();
        attempt!(m.cx.check(m.frame));
        m.memory = m.cx.first_memory();
        m.forget_last_results();
    }

    fn jump_always[const IS_BACKWARD: bool](m, op) {
        jump!(m, op.imm, IS_BACKWARD);
    }

    fn branch_on_zero[const IF_ZERO: bool, const IS_LAST: bool, const IS_BACKWARD: bool](m, op) {
        if (m.read::<u32, IS_LAST>(op.a) == 0) == IF_ZERO {
            jump!(m, op.imm, IS_BACKWARD);
        }
    }

    /// `imm` targets and then the default follow, two in a record.
    fn jump_by_table[const IS_LAST: bool, const MAY_BE_BACKWARD: bool](m, op) {
        let index = m.read::<u32, IS_LAST>(op.a).min(op.imm);
        let targets = given!(m.pc.peek(index as usize / 2)).whole();
        jump!(m, (targets >> (index % 2 * 32)) as u32, MAY_BE_BACKWARD);
    }

    /// The results are in their places.
    fn leave(_m) {
        return Outcome::value(0);
    }

    fn leave_with[T: Number, const IS_LAST: bool](m, op) {
        let bits = m.read::<T, IS_LAST>(op.a).to_slot();
        m.set(0, bits);
        return Outcome::value(bits);
    }

    fn leave_with_constant(m, op) {
        m.set(0, op.imm.into());
        return Outcome::value(op.imm.into());
    }
}

pub(crate) fn for_jump(is_backward: bool) -> Handler {
    specialize!(is_backward => const IS_BACKWARD: bool, jump_always::<IS_BACKWARD>)
}

pub(crate) fn for_branch_on_zero(if_zero: bool, is_last: bool, is_backward: bool) -> Handler {
    specialize!(if_zero => const IF_ZERO: bool, specialize!(is_last => const IS_LAST: bool,
        specialize!(is_backward => const IS_BACKWARD: bool, branch_on_zero::<IF_ZERO, IS_LAST, IS_BACKWARD>)))
}

pub(crate) fn for_table(is_last: bool, may_be_backward: bool) -> Handler {
    specialize!(is_last => const IS_LAST: bool,
        specialize!(may_be_backward => const MAY_BE_BACKWARD: bool, jump_by_table::<IS_LAST, MAY_BE_BACKWARD>))
}
