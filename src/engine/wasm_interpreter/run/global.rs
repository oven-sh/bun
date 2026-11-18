//! Globals. `imm` is the offset in the instance.

use bun_engine_wasm_format::GlobalIndex;

use crate::machine::{Handler, handlers, specialize};

macro_rules! place {
    ($m:ident, $op:ident, $is_indirect:ident) => {
        match $is_indirect {
            true => $m.cx.indirect_global($op.imm),
            false => $m.cx.global($op.imm),
        }
    };
}

handlers! {
    fn get[const IS_INDIRECT: bool](m, op) {
        let [value] = place!(m, op, IS_INDIRECT);
        m.produce(op.a, value.get());
    }

    fn set[const IS_INDIRECT: bool, const IS_LAST: bool](m, op) {
        let [place] = place!(m, op, IS_INDIRECT);
        place.set(m.read::<u64, IS_LAST>(op.a));
    }

    fn get_vector[const IS_INDIRECT: bool](m, op) {
        let [low, high] = place!(m, op, IS_INDIRECT);
        m.set_vector(op.a, u128::from(low.get()) | u128::from(high.get()) << 64);
    }

    fn set_vector[const IS_INDIRECT: bool](m, op) {
        let ([low, high], value) = (place!(m, op, IS_INDIRECT), m.vector(op.a));
        low.set(value as u64);
        high.set((value >> 64) as u64);
    }

    fn set_reference(m, op) {
        m.cx.set_reference_in_global(op.imm, m.get(op.a));
        m.forget_last_results();
    }

    /// `imm` is the index.
    fn set_indirect_reference(m, op) {
        m.cx.set_reference_in_indirect_global(GlobalIndex(op.imm), m.get(op.a));
        m.forget_last_results();
    }
}

pub(crate) fn for_get(is_indirect: bool, is_vector: bool) -> Handler {
    specialize!(is_indirect => const IS_INDIRECT: bool, match is_vector {
        true => get_vector::<IS_INDIRECT>,
        false => get::<IS_INDIRECT>,
    })
}

pub(crate) fn for_set(is_indirect: bool, is_last: bool) -> Handler {
    specialize!(is_indirect => const IS_INDIRECT: bool,
        specialize!(is_last => const IS_LAST: bool, set::<IS_INDIRECT, IS_LAST>))
}

pub(crate) fn for_set_vector(is_indirect: bool) -> Handler {
    specialize!(is_indirect => const IS_INDIRECT: bool, set_vector::<IS_INDIRECT>)
}
