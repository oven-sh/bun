//! What puts values in slots. None of it changes the last results, but for `select`.

use bun_engine_wasm_compiler::abi::NULL;

use crate::machine::{Handler, attempt, given, handlers, specialize};

handlers! {
    fn copy(m, op) {
        m.set(op.a, m.get(op.b));
    }

    fn copy_vector(m, op) {
        m.set_vector(op.a, m.vector(op.b));
    }

    fn constant(m, op) {
        m.set(op.a, op.imm.into());
    }

    fn negative_constant(m, op) {
        m.set(op.a, op.imm as i32 as u64);
    }

    fn high_constant(m, op) {
        m.set(op.a, u64::from(op.imm) << 32);
    }

    fn wide_constant(m, op, bits) {
        m.set(op.a, bits.whole());
    }

    fn vector_constant(m, op, low, high) {
        m.set_vector(op.a, u128::from(low.whole()) | u128::from(high.whole()) << 64);
    }

    fn load_far(m, op) {
        let [bits] = given!(m.operands(op.imm));
        m.set(op.a, bits);
    }

    fn store_far(m, op) {
        given!(given!(m.range(op.imm, 1)).first()).set(m.get(op.a));
    }

    /// From `imm` down to `low`.
    fn move_range(m, op, count) {
        let count = count.imm as usize;
        let (to, from) = (given!(m.range(op.low(), count)), given!(m.range(op.imm, count)));
        to.iter().zip(from).for_each(|(to, from)| to.set(from.get()));
    }

    fn clear[const COUNT: usize](m, op) {
        let first = usize::from(op.a);
        m.slots[first..first + COUNT].iter().for_each(|slot| slot.set(0));
    }

    fn fill[const WITH_NULL: bool](m, op) {
        let bits = if WITH_NULL { NULL as u64 } else { 0 };
        given!(m.range(op.low(), op.imm as usize)).iter().for_each(|slot| slot.set(bits));
    }

    /// First in a function whose frame has far slots.
    fn find_room(m, op) {
        attempt!(m.range(0, op.imm as usize), StackOverflow);
    }

    fn select[const IS_LAST: bool](m, op) {
        let holds = m.read::<u32, IS_LAST>(op.d()) != 0;
        let chosen = core::hint::select_unpredictable(holds, m.get(op.b), m.get(op.c()));
        m.produce(op.a, chosen);
    }

    fn select_vector(m, op) {
        let chosen = if m.get(op.d()) as u32 != 0 { op.b } else { op.c() };
        m.set_vector(op.a, m.vector(chosen));
    }
}

pub(crate) const MOST_CLEARED: u32 = 16;

/// It may clear more.
pub(crate) fn for_clear(count: u32) -> Handler {
    match count {
        ..=1 => clear::<1>,
        2 => clear::<2>,
        3..=4 => clear::<4>,
        5..=6 => clear::<6>,
        7..=8 => clear::<8>,
        9..=12 => clear::<12>,
        _ => clear::<{ MOST_CLEARED as usize }>,
    }
}

pub(crate) fn for_select(is_last: bool) -> Handler {
    specialize!(is_last => const IS_LAST: bool, select::<IS_LAST>)
}
