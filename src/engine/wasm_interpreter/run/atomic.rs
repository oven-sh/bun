//! Atomic accesses to memory. They have the form of [`Access::Any`], with the address in `b`.

use core::sync::atomic::{Ordering, fence};

use bun_engine_asm::{AtomicOp, Size};
use bun_engine_wasm_runtime::interpreted::Scalar;

use super::memory::{Access, Source};
use crate::machine::{Handler, attempt, given, go, handlers, specialize};

const UPDATES: [AtomicOp; 6] = {
    use AtomicOp::*;
    let all = [Add, Sub, And, Or, Xor, Exchange];
    let mut index = 0;
    while index < all.len() {
        assert!(all[index] as usize == index);
        index += 1;
    }
    all
};

macro_rules! place {
    ($m:ident, $op:ident) => {{
        let (place, last) = given!($m.place::<{ Access::Any }, { Source::Slot }>($op, $op.b));
        (place.memory, attempt!(place.start, MemoryOutOfBounds), last)
    }};
}

handlers! {
    fn load[T: Scalar](m, op) {
        let (memory, start, last) = place!(m, op);
        m.produce(op.a, attempt!(memory.atomic_load::<T>(start)).to_bits());
        go!(m, last.next);
    }

    /// The value is in `a`.
    fn store[T: Scalar](m, op) {
        let (memory, start, last) = place!(m, op);
        attempt!(memory.atomic_store(start, T::from_low_bits(m.get(op.a))));
        go!(m, last.next);
    }

    fn update[T: Scalar, const OP: u8](m, op) {
        let (memory, start, _) = place!(m, op);
        let operand = given!(m.pc.take());
        let value = T::from_low_bits(m.get(operand.a));
        let old = attempt!(memory.atomic_update(start, UPDATES[usize::from(OP)], value));
        m.produce(op.a, old.to_bits());
        go!(m, operand.next);
    }

    fn compare_exchange[T: Scalar](m, op) {
        let (memory, start, _) = place!(m, op);
        let operands = given!(m.pc.take());
        let [expected, replacement] = [operands.a, operands.b].map(|slot| T::from_low_bits(m.get(slot)));
        let old = attempt!(memory.atomic_compare_exchange(start, expected, replacement));
        m.produce(op.a, old.to_bits());
        go!(m, operands.next);
    }

    fn full_fence(m, _op) {
        fence(Ordering::SeqCst);
    }
}

macro_rules! with_scalar {
    ($size:expr => $T:ident, $body:expr) => {
        match $size {
            Size::S8 => {
                type $T = u8;
                $body
            }
            Size::S16 => {
                type $T = u16;
                $body
            }
            Size::S32 => {
                type $T = u32;
                $body
            }
            Size::S64 => {
                type $T = u64;
                $body
            }
        }
    };
}

pub(crate) use with_scalar;

pub(crate) fn for_load(size: Size) -> Handler {
    with_scalar!(size => T, load::<T>)
}

pub(crate) fn for_store(size: Size) -> Handler {
    with_scalar!(size => T, store::<T>)
}

pub(crate) fn for_update(size: Size, op: AtomicOp) -> Handler {
    with_scalar!(size => T,
        specialize!(op => const OP: AtomicOp as u8 { Add Sub And Or Xor Exchange }, update::<T, OP>))
}

pub(crate) fn for_compare_exchange(size: Size) -> Handler {
    with_scalar!(size => T, compare_exchange::<T>)
}
