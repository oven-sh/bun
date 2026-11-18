//! Shifts, masks and extensions seen as the move of one field of bits.

use bun_engine_asm::arm64::{Bitfield, BitmaskImm, Logical};
use bun_engine_asm::{Sign, Width};

use super::instruction::{Inst, Mask};
use crate::ir::{Binary, Op, Type, Unary, Value};
use crate::machine::Lowering;

/// `count` bits of `source` from bit `first` up, put at bit `to`. Below them are zeros, and above them zeros or copies
/// of the last.
#[derive(Clone, Copy)]
pub(super) struct Field {
    pub(super) source: Value,
    pub(super) first: u8,
    pub(super) count: u8,
    pub(super) to: u8,
    pub(super) is_signed: bool,
}

/// How many operations are looked through.
const DEPTH: u32 = 4;
const MANY_USES: u32 = 8;

pub(super) fn ones(count: u8) -> u64 {
    u64::MAX >> (64 - count)
}

impl Field {
    fn whole(source: Value, ty: Type) -> Self {
        Self {
            source,
            first: 0,
            count: ty.width().bits(),
            to: 0,
            is_signed: false,
        }
    }

    pub(super) fn end(self) -> u8 {
        self.to + self.count
    }

    pub(super) fn source_end(self) -> u8 {
        self.first + self.count
    }

    /// The bits of the source.
    pub(super) fn source_mask(self) -> u64 {
        ones(self.count) << self.first
    }

    /// Drops what is at and above bit `end`. The functions from here on give `None` if no field is left.
    fn below(self, end: u8) -> Option<Self> {
        if self.end() < end {
            return Some(self);
        }
        Some(Self {
            count: end.checked_sub(self.to).filter(|&count| count != 0)?,
            is_signed: false,
            ..self
        })
    }

    /// Drops what is below bit `start`.
    fn from(self, start: u8) -> Option<Self> {
        let dropped = start.saturating_sub(self.to);
        (dropped < self.count).then(|| Self {
            first: self.first + dropped,
            count: self.count - dropped,
            to: self.to + dropped,
            ..self
        })
    }

    fn shifted_left(self, amount: u8, width: u8) -> Option<Self> {
        let to = self.to + amount;
        Self { to, ..self }.below(width)
    }

    fn shifted_right(self, amount: u8) -> Option<Self> {
        let kept = self.from(amount)?;
        let to = kept.to - amount;
        Some(Self { to, ..kept })
    }

    /// Fills what is above the low `bits` bits with zeros.
    fn zero_extended(self, bits: u8) -> Option<Self> {
        self.below(bits).filter(|low| !low.is_signed)
    }

    fn sign_extended(self, bits: u8) -> Option<Self> {
        let low = self.below(bits)?;
        let is_signed = low.is_signed || low.end() == bits;
        Some(Self { is_signed, ..low })
    }

    /// The narrowest instruction that moves the field to a result of this width.
    pub(super) fn width_for(self, result: Width) -> Option<Width> {
        if self.source_end() <= result.bits() {
            Some(result)
        } else {
            (!self.is_signed).then_some(Width::W64)
        }
    }

    /// For an instruction of the `bfm` family.
    pub(super) fn rotation_and_last_bit(self, width: Width) -> Option<(u8, u8)> {
        match (self.first, self.to) {
            (first, 0) => Some((first, self.source_end() - 1)),
            (0, to) => Some((width.bits() - to, self.count - 1)),
            _ => None,
        }
    }
}

impl Lowering<'_, Inst> {
    /// Doing the work of `value` again as a part of another instruction costs less than keeping it.
    pub(super) fn dissolves(&self, value: Value) -> bool {
        !self.is_materialized(value) && self.use_count(value) <= MANY_USES && self.is_nearby(value)
    }

    pub(super) fn has_one_use_nearby(&self, value: Value) -> bool {
        self.use_count(value) <= 1 && !self.is_materialized(value) && self.is_nearby(value)
    }

    pub(super) fn constant_amount(&self, amount: Value, ty: Type) -> Option<u8> {
        Some(self.int_constant(amount)? as u8 % ty.width().bits())
    }

    /// Looks through `value` and up to `depth` more operations. `None` if it does not move bits, or leaves none.
    pub(super) fn field_of(&self, value: Value, depth: u32) -> Option<Field> {
        let ty = self.type_of(value);
        let width = ty.width().bits();
        let apply = |operand, change: &dyn Fn(Field) -> Option<Field>| {
            let looks_on =
                depth != 0 && (self.dissolves(operand) || self.representative(operand) != operand);
            looks_on
                .then(|| change(self.field_of(operand, depth - 1)?))
                .flatten()
                .or_else(|| change(Field::whole(operand, self.type_of(operand))))
        };
        let field = match self.op(value) {
            Op::Binary(Binary::Shl, [operand, amount]) => {
                let amount = self.constant_amount(amount, ty)?;
                apply(operand, &|field| field.shifted_left(amount, width))
            }
            Op::Binary(Binary::Mul, [operand, factor]) => {
                let factor = self.constant_bits(factor)?;
                let amount = factor.is_power_of_two().then(|| factor.ilog2() as u8)?;
                apply(operand, &|field| field.shifted_left(amount, width))
            }
            Op::Binary(Binary::Shr, [operand, amount]) => {
                let amount = self.constant_amount(amount, ty)?;
                apply(operand, &|field| {
                    field.zero_extended(width)?.shifted_right(amount)
                })
            }
            Op::Binary(Binary::Sar, [operand, amount]) => {
                let amount = self.constant_amount(amount, ty)?;
                apply(operand, &|field| {
                    let field = field.sign_extended(width)?;
                    let last = field.end() - 1;
                    let copies_last = field.is_signed && amount > last;
                    field.shifted_right(if copies_last { last } else { amount })
                })
            }
            Op::Binary(Binary::And, [operand, mask]) => {
                let mask = self.constant_bits(mask).filter(|&mask| mask != 0)?;
                let (start, count) = (mask.trailing_zeros() as u8, mask.count_ones() as u8);
                if mask != ones(count) << start {
                    return None;
                }
                apply(operand, &|field| {
                    let end = start + count;
                    let low = if end == width {
                        field
                    } else {
                        field.zero_extended(end)?
                    };
                    low.from(start)
                })
            }
            Op::Unary(Unary::SignExtend(size), operand) => {
                apply(operand, &|field| field.sign_extended(size.bits()))
            }
            Op::Unary(Unary::Widen(Sign::Signed), operand) => {
                apply(operand, &|field| field.sign_extended(32))
            }
            Op::Unary(Unary::Widen(Sign::Unsigned), operand) => {
                apply(operand, &|field| field.zero_extended(32))
            }
            Op::Unary(Unary::Wrap, operand) => apply(operand, &|field| field.below(32)),
            _ => None,
        }?;
        field.below(width)
    }

    /// The first result of `accept`, which is offered ever shallower views of `value`.
    #[inline]
    pub(super) fn match_field<T>(
        &self,
        value: Value,
        accept: impl Fn(Field) -> Option<T>,
    ) -> Option<T> {
        let may_move_bits = match *self.function.op(value) {
            Op::Binary(_, [_, rhs]) => self.function.op(rhs).is_constant(),
            Op::Unary(..) => true,
            _ => false,
        };
        if !may_move_bits {
            return None;
        }
        let mut source = Value::NONE;
        for depth in (0..DEPTH).rev() {
            let field = self.field_of(value, depth)?;
            if field.source != source
                && let Some(accepted) = accept(field)
            {
                return Some(accepted);
            }
            source = field.source;
        }
        None
    }

    /// The register of the source is the field, once that is shifted into place.
    pub(super) fn is_bare(&self, field: Field, width: Width) -> bool {
        field.first == 0
            && (field.end() == width.bits()
                || field.count == 32
                    && !field.is_signed
                    && self.type_of(field.source) == Type::I32
                    && self.is_zero_extended(field.source))
    }

    pub(super) fn select_field(&mut self, value: Value) -> bool {
        let result = self.type_of(value).width();
        let matched = self.match_field(value, |field| {
            let width = field.width_for(result)?;
            let op = if field.is_signed {
                Bitfield::Sbfm
            } else {
                Bitfield::Ubfm
            };
            let instruction = match field.rotation_and_last_bit(width) {
                Some((rotation, last)) => Inst::Bitfield(op, width, rotation, last),
                None if field.first == field.to && (!field.is_signed) => {
                    let mask = BitmaskImm::new(width, field.source_mask())?;
                    Inst::Logical(Logical::And, Mask::Imm(mask))
                }
                None => return None,
            };
            Some((field, instruction))
        });
        let Some((field, instruction)) = matched else {
            return false;
        };
        if self.select_narrowed_load(value, field) {
            return true;
        }
        match (field.first, field.to, field.count) {
            (0, 0, _) if self.is_bare(field, result) => self.copy(value, field.source),
            (0, 0, 32) if !field.is_signed => self.zero_extend(value, field.source),
            _ => {
                self.def(value);
                self.use_register(field.source);
                self.finish(instruction);
            }
        }
        true
    }

    /// `value` as some bits of another, where they are.
    fn bits_left_in_place(&self, value: Value) -> Option<(Value, u64)> {
        let in_place = self.match_field(value, |field| {
            (field.first == field.to && !field.is_signed)
                .then(|| (field.source, field.source_mask()))
        });
        in_place.or_else(|| match self.op(value) {
            Op::Binary(Binary::And, [kept, mask]) => Some((kept, self.constant_bits(mask)?)),
            _ => None,
        })
    }

    /// For an operation that puts together two values that have no set bit in common.
    pub(super) fn select_join_of_fields(&mut self, value: Value, lhs: Value, rhs: Value) -> bool {
        let width = self.type_of(value).width();
        if !self.has_one_use_nearby(lhs) || !self.has_one_use_nearby(rhs) {
            return false;
        }
        for (a, b) in [(lhs, rhs), (rhs, lhs)] {
            let high = self.match_field(a, |field| {
                (field.first == 0 && field.to != 0 && field.end() == width.bits()).then_some(field)
            });
            if let Some(high) = high
                && let Some(low) = self.match_field(b, |field| {
                    let is_rest = (field.first, field.to, field.count) == (high.count, 0, high.to);
                    (is_rest && !field.is_signed).then_some(field)
                })
            {
                self.def(value);
                self.use_register(high.source);
                self.use_register(low.source);
                self.finish(Inst::Extract(width, low.first));
                return true;
            }
            if let Some((kept, mask)) = self.bits_left_in_place(a)
                && let Some((inserted, (rotation, last))) = self.match_field(b, |field| {
                    let fills_gap = !field.is_signed
                        && field.source_end() <= width.bits()
                        && ones(field.count) << field.to == !mask & ones(width.bits());
                    fills_gap
                        .then_some(field.source)
                        .zip(field.rotation_and_last_bit(width))
                })
            {
                self.def_tied(value, 1, None);
                self.use_register(kept);
                self.use_late(inserted);
                self.finish(Inst::InsertBits(width, rotation, last));
                return true;
            }
        }
        false
    }
}
