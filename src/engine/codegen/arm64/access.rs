//! Emits loads, stores and moves, and does neighbours with one instruction.

use bun_engine_asm::arm64::{
    AccessSize, ArithmeticImm, ConstantMove, FP, IndexExtend, MacroAssembler, Mem as Encoded,
    PairMem, PlainAccess, SP, V31, X16, X17, ZR,
};
use bun_engine_asm::{Address, FloatAssembly, FloatWidth, Fpr, Gpr, VectorAssembly, Width};

use super::instruction::{Amode, Mem};
use crate::client::Frame;
use crate::ir::{Function, Location};
use crate::machine::{Class, Operands};

pub(super) const DATA: Gpr = X16;
pub(super) const ADDRESS: Gpr = X17;
pub(super) const VECTOR: Fpr = V31;

/// A macro assembler that knows how far apart the frame pointer and the stack pointer are.
pub(super) struct Accesses<'a> {
    pub(super) masm: &'a mut MacroAssembler,
    function: &'a Function,
    frame_size: i32,
}

#[derive(Clone, Copy)]
enum Resolved {
    Offset(Gpr, i32),
    Indexed(Gpr, Gpr, IndexExtend, bool),
}

fn resolve(address: Amode, operands: &mut Operands<'_>) -> Resolved {
    match address {
        Amode::Offset(offset) => Resolved::Offset(operands.gpr(), offset),
        Amode::Frame(offset) => Resolved::Offset(FP, offset),
        Amode::Indexed(extend, is_scaled) => {
            Resolved::Indexed(operands.gpr(), operands.gpr(), extend, is_scaled)
        }
    }
}

fn bytes(size: AccessSize) -> i32 {
    1 << size.log2_bytes()
}

impl<'a> Accesses<'a> {
    #[inline]
    pub(super) fn new(masm: &'a mut MacroAssembler, function: &'a Function, frame: &Frame) -> Self {
        Self {
            masm,
            function,
            frame_size: frame.size as i32,
        }
    }

    pub(super) fn outgoing(&self, offset: i32) -> i32 {
        offset - self.frame_size
    }

    /// The same place from the stack pointer, if that makes the offset fit.
    #[inline]
    fn nearer(&self, base: Gpr, offset: i32, fits: impl Fn(i64) -> bool) -> (Gpr, i32) {
        let from_bottom = i64::from(offset) + i64::from(self.frame_size);
        if base == FP && !fits(offset.into()) && fits(from_bottom) {
            (SP, from_bottom as i32)
        } else {
            (base, offset)
        }
    }

    fn encode_offset(&mut self, size: AccessSize, base: Gpr, offset: i32) -> Encoded {
        let (base, offset) = self.nearer(base, offset, |at| Encoded::fits_offset(size, at));
        self.masm.mem(size, Address::new(base, offset))
    }

    fn encode_resolved(&mut self, size: AccessSize, address: Resolved) -> Encoded {
        match address {
            Resolved::Offset(base, offset) => self.encode_offset(size, base, offset),
            Resolved::Indexed(base, index, extend, is_scaled) => {
                Encoded::indexed(size, base, index, extend, is_scaled)
            }
        }
    }

    pub(super) fn encode(&mut self, memory: Mem, operands: &mut Operands<'_>) -> Encoded {
        self.encode_resolved(memory.size, resolve(memory.address, operands))
    }

    /// Of an address without index.
    pub(super) fn register_with(&mut self, address: Amode, operands: &mut Operands<'_>) -> Gpr {
        let Resolved::Offset(base, offset) = resolve(address, operands) else {
            unreachable!("has an index")
        };
        if offset == 0 {
            return base;
        }
        self.add_offset(ADDRESS, base, offset);
        ADDRESS
    }

    pub(super) fn add_offset(&mut self, dst: Gpr, base: Gpr, offset: i32) {
        let (base, offset) = self.nearer(base, offset, |at| at.unsigned_abs() < 1 << 12);
        self.masm.add_constant(Width::W64, dst, base, offset.into());
    }

    // Pairs

    /// The offset fits.
    pub(super) fn encode_pair(
        &self,
        size: AccessSize,
        address: Amode,
        operands: &mut Operands<'_>,
    ) -> PairMem {
        let Resolved::Offset(base, offset) = resolve(address, operands) else {
            unreachable!("has an index")
        };
        PairMem::offset(size, base, offset.into()).unwrap()
    }

    /// The last instruction. What is in the frame is relative to the frame pointer.
    #[inline]
    fn last(&mut self) -> Option<PlainAccess> {
        let mut last = self.masm.assembler().revocable_access()?;
        if last.base == SP {
            (last.base, last.offset) = (FP, last.offset - self.frame_size);
        }
        Some(last)
    }

    /// The address of both, and whether `last` is at the lower one.
    #[inline]
    fn pair_for(&self, last: PlainAccess, next: PlainAccess) -> Option<(PairMem, bool)> {
        let distance = next.offset.wrapping_sub(last.offset);
        if last.base != next.base || distance.wrapping_abs() != bytes(next.size) {
            return None;
        }
        let low = last.offset.min(next.offset);
        let (base, low) = self.nearer(next.base, low, |at| PairMem::fits(next.size, at));
        let memory = PairMem::offset(next.size, base, low.into())?;
        last.goes_with(next).then_some((memory, distance > 0))
    }

    fn emit_pair(
        &mut self,
        last: PlainAccess,
        next: PlainAccess,
        (memory, in_order): (PairMem, bool),
    ) {
        let (low, high) = if in_order { (last, next) } else { (next, last) };
        self.masm.assembler().access_pair(low, high, memory);
    }

    /// Returns false if the offset does not fit.
    #[inline]
    fn try_plain(&mut self, mut access: PlainAccess) -> bool {
        if let Some(last) = self.last()
            && let Some(pair) = self.pair_for(last, access)
        {
            self.masm.assembler().revoke();
            self.emit_pair(last, access, pair);
            return true;
        }
        let fits = |at| Encoded::fits_offset(access.size, at);
        (access.base, access.offset) = self.nearer(access.base, access.offset, fits);
        self.masm.assembler().access_revocably(access)
    }

    #[inline]
    fn access<R: Copy>(
        &mut self,
        (size, may_pair, address): (AccessSize, bool, Resolved),
        reg: R,
        plain: fn(AccessSize, R, Gpr, i32) -> PlainAccess,
        general: fn(&mut bun_engine_asm::arm64::Assembler, R, Encoded),
    ) {
        if let (true, Resolved::Offset(base, offset)) = (may_pair, address)
            && self.try_plain(plain(size, reg, base, offset))
        {
            return;
        }
        let encoded = self.encode_resolved(size, address);
        general(self.masm.assembler(), reg, encoded);
    }

    pub(super) fn load(&mut self, dst: Gpr, src: Mem, operands: &mut Operands<'_>) {
        let src = (src.size, src.may_pair, resolve(src.address, operands));
        self.access(src, dst, PlainAccess::load, |asm, dst, src| {
            asm.ldr(dst, src)
        });
    }

    pub(super) fn store(&mut self, src: Gpr, dst: Mem, operands: &mut Operands<'_>) {
        let dst = (dst.size, dst.may_pair, resolve(dst.address, operands));
        self.access(dst, src, PlainAccess::store, |asm, src, dst| {
            asm.str(src, dst)
        });
    }

    pub(super) fn load_fpr(&mut self, dst: Fpr, src: Mem, operands: &mut Operands<'_>) {
        let src = (src.size, src.may_pair, resolve(src.address, operands));
        self.access(src, dst, PlainAccess::load_fpr, |asm, dst, src| {
            asm.ldr_fpr(dst, src);
        });
    }

    pub(super) fn store_fpr(&mut self, src: Fpr, dst: Mem, operands: &mut Operands<'_>) {
        let dst = (dst.size, dst.may_pair, resolve(dst.address, operands));
        self.access(dst, src, PlainAccess::store_fpr, |asm, src, dst| {
            asm.str_fpr(src, dst);
        });
    }

    // The frame

    pub(super) fn load_frame(&mut self, size: AccessSize, dst: Gpr, offset: i32) {
        let src = (size, true, Resolved::Offset(FP, offset));
        self.access(src, dst, PlainAccess::load, |asm, dst, src| {
            asm.ldr(dst, src)
        });
    }

    fn store_frame(&mut self, size: AccessSize, src: Gpr, offset: i32) {
        let dst = (size, true, Resolved::Offset(FP, offset));
        self.access(dst, src, PlainAccess::store, |asm, src, dst| {
            asm.str(src, dst)
        });
    }

    pub(super) fn load_frame_fpr(&mut self, size: AccessSize, dst: Fpr, offset: i32) {
        let src = (size, true, Resolved::Offset(FP, offset));
        self.access(src, dst, PlainAccess::load_fpr, |asm, dst, src| {
            asm.ldr_fpr(dst, src);
        });
    }

    fn store_frame_fpr(&mut self, size: AccessSize, src: Fpr, offset: i32) {
        let dst = (size, true, Resolved::Offset(FP, offset));
        self.access(dst, src, PlainAccess::store_fpr, |asm, src, dst| {
            asm.str_fpr(src, dst);
        });
    }

    fn load_constant(&mut self, dst: Gpr, bits: u64) {
        const REACH_OF_TWO: i64 = (1 << 24) - 1;
        if let Ok(short) = u16::try_from(bits) {
            return self.masm.move_constant(Width::W32, dst, short.into());
        }
        let constant = ConstantMove::new(Width::W64, bits);
        let near = self
            .function
            .pinned_near(bits, -REACH_OF_TWO..=REACH_OF_TWO);
        if let Some((base, distance)) = near {
            let takes_two = ArithmeticImm::new(distance.unsigned_abs()).is_none();
            if 1 + u32::from(takes_two) < constant.instructions() {
                return self.masm.add_constant(Width::W64, dst, base, distance);
            }
        }
        self.masm.assembler().move_constant(dst, constant);
    }

    pub(super) fn load_location(&mut self, size: AccessSize, dst: Gpr, from: Location) {
        match from {
            Location::Gpr(src) => self.masm.assembler().mov(Width::W64, dst, src),
            Location::Frame(offset) => self.load_frame(size, dst, offset),
            Location::Displaced(base, offset) => self.add_offset(dst, base, offset),
            Location::Constant(bits) => self.load_constant(dst, bits.get()),
            Location::Fpr(_) | Location::VectorConstant(_) => unreachable!("not an integer"),
        }
    }

    /// Fetches the value before the last store if the two stores can then be one.
    fn store_through_scratch(&mut self, size: AccessSize, from: Location, offset: i32) {
        if let Some(last) = self.last() {
            let temp = if last.gpr() == Some(DATA) {
                ADDRESS
            } else {
                DATA
            };
            let next = PlainAccess::store(size, temp, FP, offset);
            let reads_last = matches!(from, Location::Frame(source)
                if source.abs_diff(last.offset) < bytes(size) as u32);
            if let Some(pair) = self.pair_for(last, next).filter(|_| !reads_last) {
                self.masm.assembler().revoke();
                self.load_location(size, temp, from);
                return self.emit_pair(last, next, pair);
            }
        }
        self.load_location(size, DATA, from);
        self.store_frame(size, DATA, offset);
    }

    pub(super) fn store_location(&mut self, size: AccessSize, from: Location, offset: i32) {
        match from {
            Location::Gpr(src) => self.store_frame(size, src, offset),
            Location::Fpr(src) => self.store_frame_fpr(size, src, offset),
            Location::Constant(bits) if bits.get() == 0 => self.store_frame(size, ZR, offset),
            Location::Frame(source) if size == AccessSize::S128 => {
                self.load_frame_fpr(size, VECTOR, source);
                self.store_frame_fpr(size, VECTOR, offset);
            }
            Location::VectorConstant(constant) => {
                let bits = self.function.vector_constant(constant);
                self.masm.move_vector_constant(VECTOR, bits);
                self.store_frame_fpr(size, VECTOR, offset);
            }
            _ => self.store_through_scratch(size, from, offset),
        }
    }

    /// Scalars take all of their slot along, which lets all of a bank pair up.
    pub(super) fn move_between(&mut self, from: Location, to: Location, class: Class) {
        let size = if class == Class::Vector {
            AccessSize::S128
        } else {
            AccessSize::S64
        };
        match (from, to) {
            (_, Location::Frame(offset)) => self.store_location(size, from, offset),
            (_, Location::Gpr(dst)) => self.load_location(size, dst, from),
            (Location::Fpr(src), Location::Fpr(dst)) => self.masm.move_vector(dst, src),
            (Location::Frame(offset), Location::Fpr(dst)) => self.load_frame_fpr(size, dst, offset),
            (Location::Constant(bits), Location::Fpr(dst)) => {
                let width = if class == Class::Float32 {
                    FloatWidth::F32
                } else {
                    FloatWidth::F64
                };
                self.masm.move_float_constant(width, dst, bits.get());
            }
            (Location::VectorConstant(constant), Location::Fpr(dst)) => {
                let bits = self.function.vector_constant(constant);
                self.masm.move_vector_constant(dst, bits);
            }
            _ => unreachable!("no such move"),
        }
    }
}
