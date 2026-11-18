//! Addressing modes, and loads that become operands.

use bun_engine_asm::x64::RBP;
use bun_engine_asm::{Scale, Size};

use super::instruction::{Amode, Inst, Source, Stored};
use crate::ir::{Binary, Load, Op, Type, Value};
use crate::machine::{Lowering, Place, Role};

#[derive(Clone, Copy)]
pub(super) enum Base {
    None,
    Frame,
    Value(Value),
}

#[derive(Clone, Copy)]
pub(super) struct AddressParts {
    pub(super) base: Base,
    pub(super) index: Option<(Value, Scale)>,
    pub(super) offset: i32,
}

impl AddressParts {
    pub(super) fn plus(self, bytes: i32) -> Option<Self> {
        Some(Self {
            offset: self.offset.checked_add(bytes)?,
            ..self
        })
    }
}

/// An operand that has been matched but not yet given to the instruction.
#[derive(Clone, Copy)]
pub(super) enum Matched {
    Value(Value),
    Imm(i32),
    Load(Value, AddressParts),
}

const MANY_USES: u32 = 8;
/// Constant addresses that are this close share a base register.
const NEIGHBOURHOOD: i64 = 1 << 30;

impl Lowering<'_, Inst> {
    pub(super) fn immediate(&self, value: Value) -> Option<i32> {
        i32::try_from(self.int_constant(value)?).ok()
    }

    /// Adding up or scaling the operands here costs less than keeping the result.
    fn dissolves(&self, value: Value) -> bool {
        let needs_one_register = match self.op(value) {
            Op::Binary(Binary::Add, args) => args
                .iter()
                .any(|&arg| matches!(self.op(arg), Op::Pinned(_))),
            _ => true,
        };
        !self.is_materialized(value)
            && (needs_one_register || self.use_count(value) <= MANY_USES && self.is_nearby(value))
    }

    fn without_constant(&self, mut value: Value, offset: &mut i32, scale: Scale) -> Value {
        while let Op::Binary(Binary::Add, [rest, constant]) = self.op(value)
            && !self.is_materialized(value)
            && let Some(constant) = self.immediate(constant)
            && let Some(sum) = constant
                .checked_mul(1 << scale.log2())
                .and_then(|scaled| scaled.checked_add(*offset))
        {
            (value, *offset) = (rest, sum);
        }
        value
    }

    pub(super) fn scaled(&self, value: Value) -> Option<(Value, Scale)> {
        let (index, log2) = match self.op(value) {
            Op::Binary(Binary::Shl, [index, amount]) => (
                index,
                self.int_constant(amount)? as u32 % u32::from(self.type_of(value).width().bits()),
            ),
            Op::Binary(Binary::Mul, [index, factor]) => {
                let factor = self.int_constant(factor)? as u64;
                (index, factor.is_power_of_two().then(|| factor.ilog2())?)
            }
            _ => return None,
        };
        let scale = Scale::from_log2(log2 as u8)?;
        self.dissolves(value).then_some((index, scale))
    }

    fn base(&mut self, value: Value, offset: &mut i32) -> Base {
        if let Op::SlotAddress(slot) = self.op(value)
            && let Some(sum) = offset.checked_add(self.slot_offset(slot))
        {
            *offset = sum;
            return Base::Frame;
        }
        if let Some(constant) = self.int_constant(value) {
            let absolute = constant.wrapping_add((*offset).into());
            if let Ok(short) = i32::try_from(absolute) {
                *offset = short;
                return Base::None;
            }
            *offset = (absolute & (NEIGHBOURHOOD - 1)) as i32;
            return Base::Value(self.intern(Type::I64, (absolute & -NEIGHBOURHOOD) as u64));
        }
        Base::Value(value)
    }

    /// The parts have the type of `value`. For an I32 only the low half of their sum counts.
    pub(super) fn sum_parts(&mut self, lhs: Value, rhs: Value, mut offset: i32) -> AddressParts {
        let (base, (index, scale)) = match (self.scaled(rhs), self.scaled(lhs)) {
            (Some(index), _) => (lhs, index),
            (None, Some(index)) => (rhs, index),
            (None, None) if self.op(rhs).is_floating() => (rhs, (lhs, Scale::One)),
            (None, None) => (lhs, (rhs, Scale::One)),
        };
        let base = self.without_constant(base, &mut offset, Scale::One);
        let mut index = (self.without_constant(index, &mut offset, scale), scale);
        if scale == Scale::One {
            index = self.scaled(index.0).unwrap_or(index);
        }
        AddressParts {
            base: self.base(base, &mut offset),
            index: Some(index),
            offset,
        }
    }

    pub(super) fn address_parts(&mut self, address: Value, mut offset: i32) -> AddressParts {
        let address = self.without_constant(address, &mut offset, Scale::One);
        if let Op::Binary(Binary::Add, [lhs, rhs]) = self.op(address)
            && self.dissolves(address)
        {
            return self.sum_parts(lhs, rhs, offset);
        }
        if let Some(index) = self.scaled(address) {
            return AddressParts {
                base: Base::None,
                index: Some(index),
                offset,
            };
        }
        AddressParts {
            base: self.base(address, &mut offset),
            index: None,
            offset,
        }
    }

    pub(super) fn use_parts(&mut self, parts: AddressParts, role: Role) -> Amode {
        match parts.base {
            Base::None => {}
            Base::Frame => self.given(RBP.number()),
            Base::Value(base) => self.use_value(base, role, Place::Register),
        }
        if let Some((index, _)) = parts.index {
            self.use_value(index, role, Place::Register);
        }
        Amode {
            offset: parts.offset,
            has_base: !matches!(parts.base, Base::None),
            index: parts.index.map(|(_, scale)| scale),
        }
    }

    pub(super) fn use_address(&mut self, address: Value, offset: i32, role: Role) -> Amode {
        let parts = self.address_parts(address, offset);
        self.use_parts(parts, role)
    }

    pub(super) fn is_absorbable_load(&self, value: Value, user: Value) -> bool {
        matches!(
            self.op(value),
            Op::Load {
                kind: Load::Full,
                ..
            }
        ) && self.can_absorb(value, user)
    }

    pub(super) fn parts_of_load(&mut self, load: Value) -> AddressParts {
        let Op::Load {
            address, offset, ..
        } = self.op(load)
        else {
            unreachable!("not a load")
        };
        self.address_parts(address, offset)
    }

    pub(super) fn match_value_or_load(&mut self, value: Value, user: Value) -> Matched {
        if self.is_absorbable_load(value, user) {
            Matched::Load(value, self.parts_of_load(value))
        } else {
            Matched::Value(value)
        }
    }

    pub(super) fn match_source(&mut self, value: Value, user: Value) -> Matched {
        self.immediate(value)
            .map_or_else(|| self.match_value_or_load(value, user), Matched::Imm)
    }

    pub(super) fn use_matched(&mut self, matched: Matched, role: Role) -> Source {
        match matched {
            Matched::Value(value) => {
                self.use_value(value, role, Place::RegisterOrMemory);
                Source::Value
            }
            Matched::Imm(imm) => Source::Imm(imm),
            Matched::Load(load, parts) => {
                self.absorb(load);
                Source::Memory(self.use_parts(parts, role))
            }
        }
    }

    /// Only the low `size` bytes of the value count.
    pub(super) fn use_stored(&mut self, value: Value, size: Size, role: Role) -> Stored {
        let constant = self.constant_bits(value).map(|bits| {
            if size == Size::S64 {
                bits as i64
            } else {
                (bits as i32).into()
            }
        });
        if let Some(imm) = constant.and_then(|constant| i32::try_from(constant).ok()) {
            return Stored::Imm(imm);
        }
        self.use_value(value, role, Place::Register);
        Stored::Value
    }
}
