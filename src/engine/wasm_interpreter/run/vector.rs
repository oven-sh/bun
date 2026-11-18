//! Vectors of 128 bits. Relaxed operations follow the deterministic profile.

use bun_engine_asm::{
    Sign, Size, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary, lanes,
};
use bun_engine_wasm_format::VectorLoadOp;
use bun_engine_wasm_runtime::interpreted::Scalar;

use super::atomic::with_scalar;
use super::memory::{Access, Source, Stored, in_bounds};
use crate::machine::{Handler, given, go, handlers, specialize};

const fn size_of_lane<T>() -> Size {
    match size_of::<T>() {
        1 => Size::S8,
        2 => Size::S16,
        4 => Size::S32,
        _ => Size::S64,
    }
}

const fn sign(is_signed: bool) -> Sign {
    if is_signed {
        Sign::Signed
    } else {
        Sign::Unsigned
    }
}

/// So that the compiler knows that there is such a lane.
#[inline(always)]
fn lane<T>(index: u16) -> u8 {
    index as u8 % lanes::count(size_of_lane::<T>())
}

handlers! {
    fn unary[const OP: u8](m, op) {
        m.set_vector(op.a, VectorUnary::ALL[usize::from(OP)].evaluate(m.vector(op.b)));
    }

    fn binary[const OP: u8](m, op) {
        let result = VectorBinary::ALL[usize::from(OP)].evaluate(m.vector(op.b), m.vector(op.c()));
        m.set_vector(op.a, result);
    }

    fn ternary[const OP: u8](m, op) {
        let [a, b, c] = [op.b, op.c(), op.d()].map(|slot| m.vector(slot));
        m.set_vector(op.a, VectorTernary::ALL[usize::from(OP)].evaluate(a, b, c));
    }

    fn shift[const OP: u8](m, op) {
        let result = VectorShift::ALL[usize::from(OP)].evaluate(m.vector(op.b), m.get(op.c()) as u32);
        m.set_vector(op.a, result);
    }

    fn reduce[const OP: u8](m, op) {
        let result = VectorReduce::ALL[usize::from(OP)].evaluate(m.vector(op.b));
        m.produce(op.a, result);
    }

    fn shuffle(m, op, low, high) {
        let chosen = u128::from(low.whole()) | u128::from(high.whole()) << 64;
        m.set_vector(op.a, lanes::shuffle(m.vector(op.b), m.vector(op.c()), chosen.to_le_bytes()));
    }

    fn splat[T](m, op) {
        m.set_vector(op.a, lanes::splat(size_of_lane::<T>(), m.get(op.b)));
    }

    fn extract_lane[T, const IS_SIGNED: bool](m, op) {
        let bits = lanes::extract(size_of_lane::<T>(), sign(IS_SIGNED), m.vector(op.b), lane::<T>(op.c()));
        m.produce(op.a, bits);
    }

    fn replace_lane[T](m, op) {
        let result = lanes::replace(size_of_lane::<T>(), m.vector(op.b), lane::<T>(op.d()), m.get(op.c()));
        m.set_vector(op.a, result);
    }

    fn load[const ACCESS: Access, const ADDRESS: Source](m, op @ start) {
        let (place, last) = given!(m.place::<ACCESS, ADDRESS>(op, op.b));
        m.set_vector(op.a, in_bounds!(m, ACCESS, start, place.load()));
        go!(m, last.next);
    }

    fn load_extended[T, const IS_SIGNED: bool, const ACCESS: Access](m, op @ start) {
        let (place, last) = given!(m.place::<ACCESS, { Source::Slot }>(op, op.b));
        let bits = in_bounds!(m, ACCESS, start, place.load());
        m.set_vector(op.a, lanes::extend(size_of_lane::<T>(), sign(IS_SIGNED), bits));
        go!(m, last.next);
    }

    fn load_scalar[T: Stored + Scalar, const SPLATS: bool, const ACCESS: Access](m, op @ start) {
        let (place, last) = given!(m.place::<ACCESS, { Source::Slot }>(op, op.b));
        let bits = in_bounds!(m, ACCESS, start, place.load::<T>()).to_bits();
        m.set_vector(op.a, if SPLATS { lanes::splat(size_of_lane::<T>(), bits) } else { bits.into() });
        go!(m, last.next);
    }

    /// The vector and the lane are in the last record.
    fn load_lane[T: Stored + Scalar, const ACCESS: Access](m, op @ start) {
        let (place, _) = given!(m.place::<ACCESS, { Source::Slot }>(op, op.b));
        let (bits, rest) = (in_bounds!(m, ACCESS, start, place.load::<T>()), given!(m.pc.take()));
        let (vector, lane) = (m.vector(rest.a), lane::<T>(rest.b));
        m.set_vector(op.a, lanes::replace(size_of_lane::<T>(), vector, lane, bits.to_bits()));
        go!(m, rest.next);
    }

    /// The address is in `a` and the value in `b`.
    fn store[const ACCESS: Access, const ADDRESS: Source](m, op @ start) {
        let (place, last) = given!(m.place::<ACCESS, ADDRESS>(op, op.a));
        in_bounds!(m, ACCESS, start, place.store(m.vector(op.b)));
        go!(m, last.next);
    }

    fn store_lane[T: Stored + Scalar, const ACCESS: Access](m, op @ start) {
        let (place, _) = given!(m.place::<ACCESS, { Source::Slot }>(op, op.a));
        let rest = given!(m.pc.take());
        let bits = lanes::extract(size_of_lane::<T>(), Sign::Unsigned, m.vector(op.b), lane::<T>(rest.b));
        in_bounds!(m, ACCESS, start, place.store(T::from_low_bits(bits)));
        go!(m, rest.next);
    }
}

/// A function that picks the handler for an operation from so many rows of eight.
macro_rules! tables {
    ($($name:ident, $handler:ident, $Op:ident, [$($row:literal)*];)*) => {$(
        pub(crate) fn $name(op: $Op) -> Handler {
            const fn at(row: usize, column: usize) -> u8 {
                let (index, last) = (row * 8 + column, $Op::ALL.len() - 1);
                (if index < last { index } else { last }) as u8
            }
            static ROWS: [[Handler; 8]; $Op::ALL.len().div_ceil(8)] = [$([
                $handler::<{ at($row, 0) }>,
                $handler::<{ at($row, 1) }>,
                $handler::<{ at($row, 2) }>,
                $handler::<{ at($row, 3) }>,
                $handler::<{ at($row, 4) }>,
                $handler::<{ at($row, 5) }>,
                $handler::<{ at($row, 6) }>,
                $handler::<{ at($row, 7) }>,
            ]),*];
            ROWS.as_flattened()[op as usize]
        }
    )*};
}

tables! {
    for_unary, unary, VectorUnary, [0 1 2 3 4 5 6];
    for_binary, binary, VectorBinary, [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15];
    for_ternary, ternary, VectorTernary, [0 1];
    for_shift, shift, VectorShift, [0 1];
    for_reduce, reduce, VectorReduce, [0 1];
}

macro_rules! with_access {
    ($access:expr => $ACCESS:ident, $body:expr) => {
        specialize!($access => const $ACCESS: Access { First FirstShared Any }, $body)
    };
}

pub(crate) fn for_splat(size: Size) -> Handler {
    with_scalar!(size => T, splat::<T>)
}

pub(crate) fn for_extract_lane(size: Size, sign: Sign) -> Handler {
    match (size, sign) {
        (Size::S8, Sign::Signed) => extract_lane::<u8, true>,
        (Size::S16, Sign::Signed) => extract_lane::<u16, true>,
        _ => with_scalar!(size => T, extract_lane::<T, false>),
    }
}

pub(crate) fn for_replace_lane(size: Size) -> Handler {
    with_scalar!(size => T, replace_lane::<T>)
}

/// Only for a whole vector can the address be the last result.
pub(crate) fn for_load(op: VectorLoadOp, access: Access, address: Source) -> Handler {
    with_access!(access => ACCESS, match op {
        VectorLoadOp::Whole => specialize!(address => const ADDRESS: Source { Slot Last }, load::<ACCESS, ADDRESS>),
        VectorLoadOp::Extend(from, sign) => specialize!(sign == Sign::Signed => const IS_SIGNED: bool, match from {
            Size::S8 => load_extended::<u8, IS_SIGNED, ACCESS>,
            Size::S16 => load_extended::<u16, IS_SIGNED, ACCESS>,
            _ => load_extended::<u32, IS_SIGNED, ACCESS>,
        }),
        VectorLoadOp::Splat(size) => with_scalar!(size => T, load_scalar::<T, true, ACCESS>),
        VectorLoadOp::Zero(width) => match width.width().size() {
            Size::S32 => load_scalar::<u32, false, ACCESS>,
            _ => load_scalar::<u64, false, ACCESS>,
        },
    })
}

pub(crate) fn for_store(access: Access, address: Source) -> Handler {
    with_access!(access => ACCESS,
        specialize!(address => const ADDRESS: Source { Slot Last }, store::<ACCESS, ADDRESS>))
}

pub(crate) fn for_load_lane(size: Size, access: Access) -> Handler {
    with_access!(access => ACCESS, with_scalar!(size => T, load_lane::<T, ACCESS>))
}

pub(crate) fn for_store_lane(size: Size, access: Access) -> Handler {
    with_access!(access => ACCESS, with_scalar!(size => T, store_lane::<T, ACCESS>))
}
