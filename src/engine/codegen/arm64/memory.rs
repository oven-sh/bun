//! Loads, stores and atomic operations.

use bun_engine_asm::arm64::{AccessSize, AtomicUpdate, Barrier};
use bun_engine_asm::{Arm64Features, AtomicOp, Sign, Size, Width};

use super::bitfield::Field;
use super::instruction::{Inst, Mem, ZERO};
use crate::ir::{Access, AccessFlags, Heap, Load, Op, Store, Type, Unary, Value};
use crate::machine::{Lowering, Role};

pub(super) fn size_of(ty: Type) -> AccessSize {
    match ty {
        Type::V128 => AccessSize::S128,
        _ => ty.width().into(),
    }
}

impl Lowering<'_, Inst> {
    fn use_memory(&mut self, size: AccessSize, address: Value, offset: i32, access: Access) -> Mem {
        let parts = self.address_parts(address, offset, size);
        Mem {
            size,
            may_pair: size >= AccessSize::S32 && !access.has(AccessFlags::TRAPS),
            address: self.use_parts(parts, Role::Use),
        }
    }

    pub(super) fn select_load(
        &mut self,
        value: Value,
        kind: Load,
        address: Value,
        offset: i32,
        access: Access,
    ) {
        let ty = self.type_of(value);
        self.def(value);
        let instruction = match kind {
            Load::Narrow(..) | Load::Full if access.has(AccessFlags::ATOMIC) => {
                let (size, sign) = match kind {
                    Load::Narrow(size, sign) => (size, sign),
                    _ => (ty.width().size(), Sign::Unsigned),
                };
                let parts = self.parts_without_index(address, offset);
                Inst::LoadAcquire(size, sign, self.use_parts(parts, Role::Use))
            }
            Load::Narrow(size, sign) => {
                let memory = self.use_memory(size.into(), address, offset, access);
                match sign {
                    Sign::Signed => Inst::LoadSigned(Width::W32, memory),
                    Sign::Unsigned => Inst::Load(memory),
                }
            }
            Load::Full if ty.is_int() => {
                Inst::Load(self.use_memory(size_of(ty), address, offset, access))
            }
            Load::Full => Inst::LoadFloat(self.use_memory(size_of(ty), address, offset, access)),
            Load::VectorZero(size) => {
                Inst::LoadFloat(self.use_memory(size.into(), address, offset, access))
            }
            Load::VectorExtend(lanes, sign) => {
                let memory = self.use_memory(AccessSize::S64, address, offset, access);
                Inst::LoadAndExtendLanes(lanes, sign, memory)
            }
            Load::VectorSplat(lanes) => {
                let parts = self.parts_without_index(address, offset);
                Inst::LoadSplat(lanes, self.use_parts(parts, Role::Use))
            }
        };
        self.finish(instruction);
    }

    /// For a field that is some of the bytes of a load.
    pub(super) fn select_narrowed_load(&mut self, value: Value, field: Field) -> bool {
        let load = field.source;
        let Op::Load {
            kind,
            address,
            offset,
            access,
        } = self.op(load)
        else {
            return false;
        };
        let (loaded, has_sign) = match kind {
            Load::Narrow(size, sign) => (size, sign == Sign::Signed),
            _ => (self.type_of(load).width().size(), false),
        };
        let result = self.type_of(value).width();
        let (size, is_signed) = if field.first == 0 && field.count > loaded.bits() {
            // What the load has filled in is a part of the field.
            let copies_reach_end = field.is_signed || field.count == result.bits();
            if has_sign && !copies_reach_end {
                return false;
            }
            (loaded, has_sign)
        } else {
            let size = match field.count {
                8 => Size::S8,
                16 => Size::S16,
                32 => Size::S32,
                _ => return false,
            };
            (size, field.is_signed)
        };
        let is_within = field.first % 8 == 0 && field.first + size.bits() <= loaded.bits();
        let may_shrink = size == loaded || !access.has(AccessFlags::TRAPS);
        let Some(offset) = offset.checked_add((field.first / 8).into()) else {
            return false;
        };
        if field.to != 0 || !is_within || !may_shrink || !self.can_absorb_through(load, value) {
            return false;
        }
        self.absorb(load);
        self.def(value);
        let memory = self.use_memory(size.into(), address, offset, access);
        self.finish(if is_signed {
            Inst::LoadSigned(result, memory)
        } else {
            Inst::Load(memory)
        });
        true
    }

    /// Nothing but `user` depends on the load.
    fn can_absorb_through(&self, load: Value, user: Value) -> bool {
        let mut inner = self.function.operands(user)[0];
        while inner != load {
            if self.use_count(inner) != 1 {
                return false;
            }
            inner = self.function.operands(inner)[0];
        }
        self.can_absorb(load, user)
    }

    /// For the same bits in the other bank.
    pub(super) fn select_load_as(&mut self, value: Value, load: Value) -> bool {
        let Op::Load {
            kind: Load::Full,
            address,
            offset,
            access,
        } = self.op(load)
        else {
            return false;
        };
        if !self.can_absorb(load, value) {
            return false;
        }
        self.absorb(load);
        self.select_load(value, Load::Full, address, offset, access);
        true
    }

    /// A value with the same low bits.
    fn without_upper_bits(&self, value: Value, size: AccessSize) -> Value {
        let bits = 8 << size.log2_bytes();
        let is_kept = |field: Field| field.first == 0 && field.to == 0 && field.count >= bits;
        if self.is_materialized(value) {
            return value;
        }
        self.match_field(value, |field| is_kept(field).then_some(field.source))
            .unwrap_or(value)
    }

    pub(super) fn select_store(
        &mut self,
        kind: Store,
        mut stored: Value,
        address: Value,
        offset: i32,
        access: Access,
    ) {
        let size = match kind {
            Store::Narrow(size) => size.into(),
            Store::Full => size_of(self.type_of(stored)),
        };
        if access.has(AccessFlags::ATOMIC) {
            let size = match kind {
                Store::Narrow(size) => size,
                Store::Full => self.type_of(stored).width().size(),
            };
            self.use_or_zero(stored, Role::Use);
            let parts = self.parts_without_index(address, offset);
            let address = self.use_parts(parts, Role::Use);
            return self.finish(Inst::StoreRelease(size, address));
        }
        match self.op(stored) {
            Op::Unary(Unary::Bitcast, bits) if kind == Store::Full && self.dissolves(stored) => {
                stored = bits;
            }
            _ if kind != Store::Full => stored = self.without_upper_bits(stored, size),
            _ => {}
        }
        let stored_bits = u64::MAX >> (64 - (8 << size.log2_bytes()).min(64));
        let is_zero = self
            .constant_bits(stored)
            .is_some_and(|bits| bits & stored_bits == 0);
        if is_zero {
            self.given(ZERO);
        } else {
            self.use_register(stored);
        }
        let memory = self.use_memory(size, address, offset, access);
        self.finish(if is_zero || self.type_of(stored).is_int() {
            Inst::Store(memory)
        } else {
            Inst::StoreFloat(memory)
        });
    }

    pub(super) fn select_load_lane(
        &mut self,
        value: Value,
        (lanes, lane): (Size, u8),
        [vector, address]: [Value; 2],
        offset: i32,
    ) {
        self.def_tied(value, 1, None);
        self.use_register(vector);
        let parts = self.parts_without_index(address, offset);
        let address = self.use_parts(parts, Role::Use);
        self.finish(Inst::LoadLane(lanes, lane, address));
    }

    pub(super) fn select_store_lane(
        &mut self,
        (lanes, lane): (Size, u8),
        [vector, address]: [Value; 2],
        offset: i32,
        access: Access,
    ) {
        self.use_register(vector);
        if lane == 0 {
            let memory = self.use_memory(lanes.into(), address, offset, access);
            return self.finish(Inst::StoreFloat(memory));
        }
        let parts = self.parts_without_index(address, offset);
        let address = self.use_parts(parts, Role::Use);
        self.finish(Inst::StoreLane(lanes, lane, address));
    }

    pub(super) fn select_atomic_update(
        &mut self,
        value: Value,
        op: AtomicOp,
        size: Size,
        [mut operand, address]: [Value; 2],
    ) {
        if !self.features.contains(Arm64Features::LSE) {
            self.def_early(value, 0);
            self.use_or_zero(operand, Role::Use);
            self.use_register(address);
            return self.finish(Inst::AtomicLoop(op, size));
        }
        let update = match op {
            AtomicOp::Add | AtomicOp::Sub => AtomicUpdate::Ldaddal,
            AtomicOp::And => AtomicUpdate::Ldclral,
            AtomicOp::Or => AtomicUpdate::Ldsetal,
            AtomicOp::Xor => AtomicUpdate::Ldeoral,
            AtomicOp::Exchange => AtomicUpdate::Swpal,
        };
        let mut preparation = matches!(op, AtomicOp::Sub | AtomicOp::And).then_some(op);
        if let (Some(op), Some(bits)) = (preparation, self.constant_bits(operand)) {
            let prepared = if op == AtomicOp::Sub {
                bits.wrapping_neg()
            } else {
                !bits
            };
            let low_bytes = prepared & u64::MAX >> (64 - size.bits());
            operand = self.intern(self.type_of(value), low_bytes);
            preparation = None;
        }
        self.def(value);
        self.use_or_zero(operand, Role::Use);
        self.use_register(address);
        self.finish(Inst::AtomicUpdate(update, size, preparation));
    }

    pub(super) fn select_compare_exchange(
        &mut self,
        value: Value,
        size: Size,
        [expected, replacement, address]: [Value; 3],
    ) {
        if self.features.contains(Arm64Features::LSE) {
            self.def_tied(value, 1, None);
        } else {
            self.def_early(value, 0);
        }
        self.use_or_zero(expected, Role::Use);
        self.use_or_zero(replacement, Role::LateUse);
        self.use_late(address);
        self.finish(Inst::AtomicCompareExchange(size));
    }

    pub(super) fn select_fence(&mut self, reads: Heap, writes: Heap) {
        let barrier = match (reads != Heap::NOTHING, writes != Heap::NOTHING) {
            (true, true) => Barrier::Ish,
            (true, false) => Barrier::Ishst,
            (false, true) => Barrier::Ishld,
            (false, false) => return,
        };
        self.finish(Inst::Fence(barrier));
    }
}
