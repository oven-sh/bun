//! Addressing modes.

use bun_engine_asm::Width;
use bun_engine_asm::arm64::{AccessSize, ArithmeticImm, FP, IndexExtend, Mem as Encoded};

use smallvec::SmallVec;

use super::bitfield::{Field, ones};
use super::instruction::{Amode, Inst};
use crate::ir::{Binary, Op, Type, Value};
use crate::machine::{Lowering, Place, Role};

const MOST_STEPS: u32 = 8;
const MOST_HOISTED: usize = 4;

/// The last few items of a kind.
struct Recent<T> {
    items: [Option<T>; 4],
    oldest: usize,
}

impl<T: Copy> Recent<T> {
    fn find(&self, matches: impl Fn(&T) -> bool) -> Option<T> {
        self.items.iter().flatten().copied().find(matches)
    }

    fn add(&mut self, item: T) {
        self.items[self.oldest] = Some(item);
        self.oldest = (self.oldest + 1) % self.items.len();
    }
}

impl<T: Copy> Default for Recent<T> {
    fn default() -> Self {
        Self {
            items: [None; 4],
            oldest: 0,
        }
    }
}

/// Addresses from which others may be within reach.
pub(super) struct Neighbours {
    constants: Recent<i64>,
    /// An address, a distance, and their sum.
    sums: Recent<(Value, i64, Value)>,
    /// An index, the size of the access, and the index divided by that.
    unscaled: Recent<(Value, AccessSize, Value)>,
    /// What precedes this instruction: a base, an offset, and their sum.
    before_loop: Value,
    hoisted: SmallVec<[(Value, i64, Value); MOST_HOISTED]>,
}

impl Default for Neighbours {
    fn default() -> Self {
        Self {
            constants: Recent::default(),
            sums: Recent::default(),
            unscaled: Recent::default(),
            before_loop: Value::NONE,
            hoisted: SmallVec::new(),
        }
    }
}

#[derive(Clone, Copy)]
pub(super) struct AddressParts {
    pub(super) mode: Amode,
    pub(super) base: Value,
    pub(super) index: Value,
}

impl AddressParts {
    pub(super) fn new(mode: Amode, base: Value) -> Self {
        let index = Value::NONE;
        Self { mode, base, index }
    }
}

fn fits(size: AccessSize, offset: i64) -> bool {
    Encoded::fits_offset(size, offset)
}

/// A round number from which `number` is within reach.
fn rounded(size: AccessSize, number: i64, masks: &[i64]) -> i64 {
    let mut candidates = masks.iter().map(|low| number & !low);
    candidates
        .find(|&round| fits(size, number - round))
        .unwrap_or(number & !0xff)
}

/// One instruction can add what the access cannot.
fn can_be_split(size: AccessSize, offset: i64) -> bool {
    ArithmeticImm::new((offset & !0xfff).unsigned_abs()).is_some() && fits(size, offset & 0xfff)
}

impl Lowering<'_, Inst> {
    pub(super) fn frame_offset(&self, value: Value) -> Option<i32> {
        match self.op(value) {
            Op::SlotAddress(slot) => Some(self.slot_offset(slot)),
            Op::Pinned(FP) => Some(0),
            _ => None,
        }
    }

    /// `value` as another plus a constant.
    fn displaced(&self, value: Value) -> Option<(Value, i64)> {
        match self.op(value) {
            Op::Binary(Binary::Add, [rest, constant]) => Some((rest, self.int_constant(constant)?)),
            Op::Binary(Binary::Sub, [rest, constant]) => {
                Some((rest, self.int_constant(constant)?.wrapping_neg()))
            }
            _ => None,
        }
        .filter(|_| !self.is_materialized(value))
    }

    /// The sum, if it needs no definition.
    fn floating_sum(&mut self, value: Value, offset: i64) -> Option<Value> {
        let (reg, offset) = match self.op(value) {
            Op::Const64(bits) => {
                return Some(self.intern(Type::I64, bits.get().wrapping_add_signed(offset)));
            }
            Op::Pinned(reg) => (reg, offset),
            _ => (FP, offset.wrapping_add(self.frame_offset(value)?.into())),
        };
        Some(self.intern_displaced(reg, offset.try_into().ok()?))
    }

    /// How an access extends and scales an index by itself.
    fn folded_index(&self, value: Value, size: AccessSize) -> Option<(Amode, Value)> {
        if self.is_materialized(value) {
            return None;
        }
        self.match_field(value, |field| {
            let extend = if self.is_bare(field, Width::W64) {
                IndexExtend::Lsl
            } else if (field.first, field.count) != (0, 32) {
                return None;
            } else if field.is_signed {
                IndexExtend::Sxtw
            } else {
                IndexExtend::Uxtw
            };
            let is_scaled = field.to != 0;
            (!is_scaled || field.to == size.log2_bytes())
                .then_some((Amode::Indexed(extend, is_scaled), field.source))
        })
    }

    /// For bits that are moved to where the access can scale them to, the same bits at the bottom.
    fn unscaled_index(&mut self, value: Value, size: AccessSize) -> Option<Value> {
        let inner = self.representative(value);
        let known = &self.selection.neighbours.unscaled;
        if let Some((.., unscaled)) = known.find(|known| (known.0, known.1) == (inner, size)) {
            return Some(unscaled);
        }
        if !self.has_one_use_nearby(inner) {
            return None;
        }
        let field = self.match_field(inner, |field| {
            let takes_two_steps = field.first != 0 && field.first != field.to;
            (takes_two_steps && !field.is_signed && field.to == size.log2_bytes() && field.to != 0)
                .then_some(field)
        })?;
        let (ty, next) = (self.type_of(field.source), self.function.next(inner));
        let amount = self.intern(Type::I32, field.first.into());
        let mask = self.intern(ty, ones(field.count));
        let shifted = Op::Binary(Binary::Shr, [field.source, amount]);
        let shifted = self.insert_before(next, shifted, ty);
        let unscaled = self.insert_before(next, Op::Binary(Binary::And, [shifted, mask]), ty);
        self.selection
            .neighbours
            .unscaled
            .add((inner, size, unscaled));
        Some(unscaled)
    }

    fn indexed(&mut self, base: Value, index: Value, size: AccessSize) -> AddressParts {
        let scaled = Amode::Indexed(IndexExtend::Lsl, true);
        for (base, index) in [(base, index), (index, base)] {
            let unscaled = self
                .unscaled_index(index, size)
                .map(|index| (scaled, index));
            if let Some((mode, index)) = unscaled.or_else(|| self.folded_index(index, size)) {
                return AddressParts { mode, base, index };
            }
        }
        let mode = Amode::Indexed(IndexExtend::Lsl, false);
        AddressParts { mode, base, index }
    }

    fn takes_no_register(&self, size: AccessSize, offset: i64) -> bool {
        fits(size, offset) || !self.is_in_loop() && can_be_split(size, offset)
    }

    fn absolute(&mut self, address: i64, size: AccessSize) -> AddressParts {
        let reach = i32::MIN.into()..=i32::MAX.into();
        let base = match self.function.pinned_near(address as u64, reach) {
            Some((_, distance)) if self.takes_no_register(size, distance) => {
                address.wrapping_sub(distance)
            }
            _ => {
                let known = &mut self.selection.neighbours.constants;
                let found = known.find(|&base| fits(size, address.wrapping_sub(base)));
                found.unwrap_or_else(|| {
                    let base = rounded(size, address, &[0xffff, 0xfff]);
                    known.add(base);
                    base
                })
            }
        };
        let mode = Amode::Offset(address.wrapping_sub(base) as i32);
        AddressParts::new(mode, self.intern(Type::I64, base as u64))
    }

    /// The operands of a sum that is not needed as such, in an order that `suits`.
    fn base_and_index(
        &self,
        address: Value,
        suits: impl Fn(Value, Value) -> bool,
    ) -> Option<[Value; 2]> {
        match self.op(address) {
            Op::Binary(Binary::Add, [lhs, rhs]) if self.dissolves(address) => {
                let orders = [[lhs, rhs], [rhs, lhs]];
                orders.into_iter().find(|&[base, index]| suits(base, index))
            }
            _ => None,
        }
    }

    fn floating_base_and_index(&self, address: Value) -> Option<[Value; 2]> {
        self.base_and_index(address, |base, _| self.op(base).is_floating())
    }

    fn is_not_negative(&self, index: Value) -> bool {
        let leaves_sign_clear = |field: Field| (!field.is_signed && field.end() < 64).then_some(());
        self.match_field(index, leaves_sign_clear).is_some()
    }

    fn sum_before_loop(&mut self, base: Value, offset: i64) -> Option<Value> {
        let place = self.before_loop(base)?;
        let known = &mut self.selection.neighbours;
        if known.before_loop != place {
            known.before_loop = place;
            known.hoisted.clear();
        }
        let mut hoisted = known.hoisted.iter();
        if let Some(&(.., sum)) = hoisted.find(|known| (known.0, known.1) == (base, offset)) {
            return Some(sum);
        }
        if known.hoisted.len() == MOST_HOISTED {
            return None;
        }
        let operands = [base, self.intern(Type::I64, offset as u64)];
        let sum = self.insert_before(place, Op::Binary(Binary::Add, operands), Type::I64);
        self.selection.neighbours.hoisted.push((base, offset, sum));
        Some(sum)
    }

    /// Adds the offset to the base, which happens outside loops.
    fn offset_into_base(
        &mut self,
        address: Value,
        offset: i64,
        size: AccessSize,
    ) -> Option<AddressParts> {
        let is_in_loop = self.is_in_loop();
        if self.use_count(address) > 1 + u32::from(is_in_loop) {
            return None;
        }
        let [base, index] = self.floating_base_and_index(address).or_else(|| {
            // The sum is between the base and the access, and so in the same object.
            self.base_and_index(address, |base, index| {
                is_in_loop
                    && offset > 0
                    && self.before_loop(base).is_some()
                    && self.is_not_negative(index)
            })
        })?;
        let needs_adding =
            self.folded_addend(index).is_some() && self.folded_index(index, size).is_none();
        let gains = if fits(size, offset) {
            let is_at_hand = matches!(self.op(base), Op::Pinned(_));
            (is_in_loop || !is_at_hand) && !needs_adding
        } else {
            is_in_loop || !needs_adding
        };
        if !gains {
            return None;
        }
        let base = self
            .floating_sum(base, offset)
            .or_else(|| self.sum_before_loop(base, offset))?;
        Some(self.indexed(base, index, size))
    }

    /// Computes an address near the distant one right after `address`, where other accesses can use it too.
    fn from_shared_sum(
        &mut self,
        address: Value,
        offset: i64,
        size: AccessSize,
    ) -> Option<AddressParts> {
        let near =
            |sum, distance| AddressParts::new(Amode::Offset((offset - distance) as i32), sum);
        let known = self.selection.neighbours.sums.find(|&(from, distance, _)| {
            from == address && distance <= offset && fits(size, offset - distance)
        });
        if let Some((_, distance, sum)) = known {
            return Some(near(sum, distance));
        }
        let distance = rounded(size, offset, &[0xfff]);
        if let Some(sum) = self.floating_sum(address, distance) {
            return Some(near(sum, distance));
        }
        // What is between two places in an object is in the object.
        let is_shared = self.use_count(address) > 1 && offset > 0;
        let next = match self.op(address) {
            Op::Param(_) => self.function.first(self.function.block_of(address)),
            _ => self.function.next(address),
        };
        let next = next.expand().filter(|_| is_shared)?;
        let moved_base = self
            .floating_base_and_index(address)
            .and_then(|[base, index]| Some([self.floating_sum(base, distance)?, index]));
        let operands =
            moved_base.unwrap_or_else(|| [address, self.intern(Type::I64, distance as u64)]);
        let sum = self.insert_before(next, Op::Binary(Binary::Add, operands), Type::I64);
        self.selection.neighbours.sums.add((address, distance, sum));
        Some(near(sum, distance))
    }

    pub(super) fn address_parts(
        &mut self,
        mut address: Value,
        offset: i32,
        size: AccessSize,
    ) -> AddressParts {
        let mut offset = i64::from(offset);
        for _ in 0..MOST_STEPS {
            let Some((rest, constant)) = self.displaced(address) else {
                break;
            };
            let sum = offset.wrapping_add(constant);
            let is_worth_sharing = self.use_count(address) > 1
                && fits(size, offset)
                && !fits(size, sum)
                && !self.op(rest).is_floating();
            if is_worth_sharing {
                break;
            }
            (address, offset) = (rest, sum);
        }
        if let Some(constant) = self.int_constant(address) {
            return self.absolute(constant.wrapping_add(offset), size);
        }
        if let Some(slot) = self.frame_offset(address)
            && let Ok(offset) = i32::try_from(offset.wrapping_add(slot.into()))
        {
            return AddressParts::new(Amode::Frame(offset), Value::NONE);
        }
        if offset == 0 {
            return match self.op(address) {
                Op::Binary(Binary::Add, [lhs, rhs]) if self.dissolves(address) => {
                    self.indexed(lhs, rhs, size)
                }
                _ => AddressParts::new(Amode::Offset(0), address),
            };
        }
        if let Some(parts) = self.offset_into_base(address, offset, size) {
            return parts;
        }
        if fits(size, offset) {
            return AddressParts::new(Amode::Offset(offset as i32), address);
        }
        if self.folded_index(address, size).is_none() {
            if let Some(parts) = self.from_shared_sum(address, offset, size) {
                return parts;
            }
            if self.takes_no_register(size, offset) {
                return AddressParts::new(Amode::Offset(offset as i32), address);
            }
        }
        let constant = self.intern(Type::I64, offset as u64);
        self.indexed(constant, address, size)
    }

    /// For the instructions that take nothing but a register.
    pub(super) fn parts_without_index(&mut self, address: Value, offset: i32) -> AddressParts {
        let parts = self.address_parts(address, offset, AccessSize::S8);
        match parts.mode {
            Amode::Indexed(..) => AddressParts::new(Amode::Offset(offset), address),
            _ => parts,
        }
    }

    pub(super) fn use_parts(&mut self, parts: AddressParts, role: Role) -> Amode {
        for part in [parts.base, parts.index] {
            if !part.is_none() {
                self.use_value(part, role, Place::Register);
            }
        }
        parts.mode
    }
}
