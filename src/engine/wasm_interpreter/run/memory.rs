//! Loads and stores.

use core::marker::ConstParamTy;

use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::{LoadOp, StoreOp};
use bun_engine_wasm_runtime::interpreted::View;

use crate::code::{Op, index_before};
use crate::machine::{Handler, Machine, Number, fail, given, go, handlers, specialize};

/// Which memory, and how the address is found.
#[derive(Clone, Copy, PartialEq, Eq, ConstParamTy)]
pub(crate) enum Access {
    /// The first memory, which has addresses of 32 bits. `imm` is the offset.
    First,
    FirstShared,
    /// `imm` tells where the view is, and the offset has a record of its own.
    Any,
}

#[derive(Clone, Copy, PartialEq, Eq, ConstParamTy)]
pub(crate) enum Source {
    Slot,
    Last,
    /// An address is zero, and a value has 16 bits.
    Constant,
}

pub(crate) trait Stored: Copy {
    fn load(memory: View, start: u64, is_shared: bool) -> Option<Self>;
    fn store(self, memory: View, start: u64, is_shared: bool) -> Option<()>;
}

macro_rules! stored {
    ($($type:ty),*) => {$(
        impl Stored for $type {
            #[inline(always)]
            fn load(memory: View, start: u64, is_shared: bool) -> Option<Self> {
                match is_shared {
                    true => memory.load_shared(start),
                    false => Some(Self::from_le_bytes(memory.bytes(start)?.get())),
                }
            }

            #[inline(always)]
            fn store(self, memory: View, start: u64, is_shared: bool) -> Option<()> {
                match is_shared {
                    true => memory.store_shared(start, self),
                    false => memory.bytes(start).map(|place| place.set(self.to_le_bytes())),
                }
            }
        }
    )*};
}

stored!(u8, u16, u32, u64);

impl Stored for u128 {
    #[inline(always)]
    fn load(memory: View, start: u64, is_shared: bool) -> Option<Self> {
        if !is_shared {
            return Some(Self::from_le_bytes(memory.bytes(start)?.get()));
        }
        let high = memory.load_shared::<u64>(start.checked_add(8)?)?;
        Some(Self::from(memory.load_shared::<u64>(start)?) | Self::from(high) << 64)
    }

    #[inline(always)]
    fn store(self, memory: View, start: u64, is_shared: bool) -> Option<()> {
        if !is_shared {
            return (memory.bytes(start)).map(|place| place.set(self.to_le_bytes()));
        }
        memory.store_shared(start.checked_add(8)?, (self >> 64) as u64)?;
        memory.store_shared(start, self as u64)
    }
}

pub(crate) struct Place {
    pub(crate) memory: View,
    /// `None` if it does not fit.
    pub(crate) start: Option<u64>,
    is_shared: bool,
}

impl Place {
    #[inline(always)]
    pub(crate) fn load<T: Stored>(&self) -> Option<T> {
        T::load(self.memory, self.start?, self.is_shared)
    }

    #[inline(always)]
    pub(crate) fn store<T: Stored>(&self, value: T) -> Option<()> {
        value.store(self.memory, self.start?, self.is_shared)
    }
}

impl<'a> Machine<'a, '_> {
    /// Also gives the last record.
    #[inline(always)]
    pub(crate) fn place<const ACCESS: Access, const ADDRESS: Source>(
        &mut self,
        op: &'a Op,
        slot: u16,
    ) -> Option<(Place, &'a Op)> {
        let address = match ADDRESS {
            Source::Slot => self.get(slot),
            Source::Last => self.int,
            Source::Constant => 0,
        };
        if ACCESS == Access::Any {
            let (offset, (memory, is_shared)) = (self.pc.take()?, self.cx.memory(op.imm));
            let start = address.checked_add(offset.whole());
            return Some((
                Place {
                    memory,
                    start,
                    is_shared,
                },
                offset,
            ));
        }
        let place = Place {
            memory: self.memory,
            start: Some(u64::from(address as u32) + u64::from(op.imm)),
            is_shared: ACCESS == Access::FirstShared,
        };
        Some((place, op))
    }
}

/// What an access gives. `$start` is the position of the instruction.
macro_rules! in_bounds {
    ($m:ident, $access:ident, $start:ident, $result:expr) => {
        match $result {
            Some(value) => value,
            None if $access == $crate::run::memory::Access::FirstShared => {
                core::hint::cold_path();
                $crate::machine::go!($m, $crate::run::memory::again_if_grown, $start)
            }
            None => $crate::machine::fail!(bun_engine_wasm_compiler::abi::Trap::MemoryOutOfBounds),
        }
    };
}

pub(crate) use in_bounds;

/// What is in memory, and what it becomes.
#[derive(Clone, Copy, PartialEq, Eq, ConstParamTy)]
pub(crate) enum Loaded {
    U8,
    U16,
    U32,
    U64,
    I8AsI32,
    I16AsI32,
    I8AsI64,
    I16AsI64,
    I32AsI64,
    F32,
    F64,
}

impl From<LoadOp> for Loaded {
    fn from(op: LoadOp) -> Self {
        match op {
            LoadOp::I32Load8U | LoadOp::I64Load8U => Self::U8,
            LoadOp::I32Load16U | LoadOp::I64Load16U => Self::U16,
            LoadOp::I32Load | LoadOp::I64Load32U => Self::U32,
            LoadOp::I64Load => Self::U64,
            LoadOp::I32Load8S => Self::I8AsI32,
            LoadOp::I32Load16S => Self::I16AsI32,
            LoadOp::I64Load8S => Self::I8AsI64,
            LoadOp::I64Load16S => Self::I16AsI64,
            LoadOp::I64Load32S => Self::I32AsI64,
            LoadOp::F32Load => Self::F32,
            LoadOp::F64Load => Self::F64,
        }
    }
}

trait FromLowBits: Stored {
    fn from_low_bits(bits: u64) -> Self;
}

macro_rules! from_low_bits {
    ($($type:ty),*) => {$(
        impl FromLowBits for $type {
            #[inline(always)]
            fn from_low_bits(bits: u64) -> Self {
                bits as Self
            }
        }
    )*};
}

from_low_bits!(u8, u16, u32, u64);

handlers! {
    /// Another thread may have made the first memory grow.
    #[cold]
    fn again_if_grown(m) {
        let memory = m.cx.first_memory();
        if !memory.reaches_further_than(m.memory) {
            fail!(Trap::MemoryOutOfBounds);
        }
        m.memory = memory;
        let ops = m.frame.ops.get();
        go!(m, given!(ops.get(index_before(ops, m.pc.site()))).next);
    }

    fn load[const KIND: Loaded, const ACCESS: Access, const ADDRESS: Source](m, op @ start) {
        let (place, last) = given!(m.place::<ACCESS, ADDRESS>(op, op.b));
        macro_rules! produce {
            ($stored:ty, |$bits:ident| $value:expr) => {{
                let $bits = in_bounds!(m, ACCESS, start, place.load::<$stored>());
                m.produce(op.a, $value);
            }};
        }
        match KIND {
            Loaded::U8 => produce!(u8, |bits| u32::from(bits)),
            Loaded::U16 => produce!(u16, |bits| u32::from(bits)),
            Loaded::U32 => produce!(u32, |bits| bits),
            Loaded::U64 => produce!(u64, |bits| bits),
            Loaded::I8AsI32 => produce!(u8, |bits| bits as i8 as u32),
            Loaded::I16AsI32 => produce!(u16, |bits| bits as i16 as u32),
            Loaded::I8AsI64 => produce!(u8, |bits| bits as i8 as u64),
            Loaded::I16AsI64 => produce!(u16, |bits| bits as i16 as u64),
            Loaded::I32AsI64 => produce!(u32, |bits| bits as i32 as u64),
            Loaded::F32 => produce!(u32, |bits| f32::from_bits(bits)),
            Loaded::F64 => produce!(u64, |bits| f64::from_bits(bits)),
        }
        go!(m, last.next);
    }

    /// The address is in `a` and the value in `b`. `V` tells which result is the last.
    #[allow(private_bounds, reason = "it is called through its address")]
    fn store[T: FromLowBits, V: Number, const ACCESS: Access, const ADDRESS: Source, const VALUE: Source](
        m, op @ start
    ) {
        let (place, last) = given!(m.place::<ACCESS, ADDRESS>(op, op.a));
        let bits = match VALUE {
            Source::Slot => m.get(op.b),
            Source::Last => V::last(&m).to_slot(),
            Source::Constant => op.b as i16 as u64,
        };
        in_bounds!(m, ACCESS, start, place.store(T::from_low_bits(bits)));
        go!(m, last.next);
    }

    fn size(m, op) {
        m.produce(op.a, m.cx.memory_size(op.imm));
    }
}

/// With [`Access::Any`] the address is in a slot.
pub(crate) fn for_load(kind: Loaded, access: Access, address: Source) -> Handler {
    specialize!(kind => const KIND: Loaded {
        U8 U16 U32 U64 I8AsI32 I16AsI32 I8AsI64 I16AsI64 I32AsI64 F32 F64
    }, match access {
        Access::Any => load::<KIND, { Access::Any }, { Source::Slot }>,
        _ => specialize!(access => const ACCESS: Access { First FirstShared },
            specialize!(address => const ADDRESS: Source { Slot Last Constant }, load::<KIND, ACCESS, ADDRESS>)),
    })
}

fn store_of<T: FromLowBits>(access: Access, address: Source, value: Source) -> Handler {
    match access {
        Access::Any => store::<T, u64, { Access::Any }, { Source::Slot }, { Source::Slot }>,
        _ => specialize!(access => const ACCESS: Access { First FirstShared },
            specialize!(address => const ADDRESS: Source { Slot Last Constant },
                specialize!(value => const VALUE: Source { Slot Last Constant },
                    store::<T, u64, ACCESS, ADDRESS, VALUE>))),
    }
}

/// With [`Access::Any`] both are in slots. The last result is that for integers.
pub(crate) fn for_store(op: StoreOp, access: Access, address: Source, value: Source) -> Handler {
    match op.size().bytes() {
        1 => store_of::<u8>(access, address, value),
        2 => store_of::<u16>(access, address, value),
        4 => store_of::<u32>(access, address, value),
        _ => store_of::<u64>(access, address, value),
    }
}

/// In the first memory.
pub(crate) fn for_store_of_last_float(op: StoreOp, access: Access, address: Source) -> Handler {
    specialize!(access => const ACCESS: Access { First FirstShared },
    specialize!(address => const ADDRESS: Source { Slot Last Constant }, match op {
        StoreOp::F32Store => store::<u32, f32, ACCESS, ADDRESS, { Source::Last }>,
        _ => store::<u64, f64, ACCESS, ADDRESS, { Source::Last }>,
    }))
}
