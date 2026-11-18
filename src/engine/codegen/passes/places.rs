//! The bytes that an instruction loads or stores, in a form that can be compared.

use bun_engine_asm::Sign;

use crate::ir::{AccessFlags, Binary, Checked, Function, Load, Op, Store, Type, Unary, Value};

/// `size` bytes at `base + (extension(index + step) << shift) + offset`. What is `NONE` counts as zero.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub(super) struct Address {
    base: Value,
    index: Value,
    extension: Option<Sign>,
    shift: u8,
    step: i32,
    offset: i64,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) struct Place {
    pub(super) address: Address,
    pub(super) size: u32,
}

/// An operation with a constant on the right.
fn with_constant(function: &Function, value: Value) -> Option<(Binary, Value, i64)> {
    let (op, [lhs, rhs]) = match *function.op(value) {
        Op::Binary(op, args) => (op, args),
        Op::Checked(Checked::Add, args, _) => (Binary::Add, args),
        _ => return None,
    };
    let constant = function.int_constant(function.resolve(rhs))?;
    Some((op, function.resolve(lhs), constant))
}

impl Address {
    fn new(function: &Function, address: Value, offset: i32) -> Self {
        let mut result = Self {
            base: Value::NONE,
            index: Value::NONE,
            extension: None,
            shift: 0,
            step: 0,
            offset: offset.into(),
        };
        result.base = result.take_offset(function, function.resolve(address));
        if let Some(sum) = result.base.expand()
            && let Op::Binary(Binary::Add, args) = *function.op(sum)
        {
            let [a, b] = args.map(|arg| function.resolve(arg));
            let looks_like_index = |value| match *function.op(value) {
                Op::Binary(Binary::Shl, _) | Op::Unary(Unary::Widen(_), _) => 2,
                Op::Pinned(_) | Op::SlotAddress(_) => 0,
                _ => 1,
            };
            let (base, index) = if (looks_like_index(a), a) > (looks_like_index(b), b) {
                (b, a)
            } else {
                (a, b)
            };
            result.base = result.take_offset(function, base);
            result.take_index(function, index);
        }
        result
    }

    /// Returns the rest.
    fn take_offset(&mut self, function: &Function, mut value: Value) -> Value {
        const MOST_STEPS: usize = 4;
        for _ in 0..MOST_STEPS {
            let Some((Binary::Add, rest, constant)) = with_constant(function, value) else {
                break;
            };
            (value, self.offset) = (rest, self.offset.wrapping_add(constant));
        }
        if let Some(constant) = function.int_constant(value) {
            (value, self.offset) = (Value::NONE, self.offset.wrapping_add(constant));
        }
        value
    }

    fn take_index(&mut self, function: &Function, mut index: Value) {
        if let Some((Binary::Shl, rest, amount)) = with_constant(function, index) {
            (index, self.shift) = (rest, amount as u8 % 64);
        }
        if let Op::Unary(Unary::Widen(sign), narrow) = *function.op(index) {
            (index, self.extension) = (function.resolve(narrow), Some(sign));
            if let Some((Binary::Add, rest, step)) = with_constant(function, index) {
                (index, self.step) = (rest, step as i32);
            }
        } else if let Some((Binary::Add, rest, step)) = with_constant(function, index) {
            (index, self.offset) = (rest, self.offset.wrapping_add(step << self.shift));
        }
        self.index = index;
    }

    /// The low 32 bits of what is constant, for which it does not matter how the index is extended.
    fn low_distance(&self) -> i32 {
        let scaled = self.step.unbounded_shl(self.shift.into());
        scaled.wrapping_add(self.offset as i32)
    }
}

impl Place {
    /// Of a load or store that is not atomic.
    pub(super) fn of(function: &Function, value: Value) -> Option<Self> {
        let (address, offset, size, access) = match *function.op(value) {
            Op::Load {
                kind,
                address,
                offset,
                access,
            } => {
                let size = match kind {
                    Load::Narrow(size, _) | Load::VectorSplat(size) | Load::VectorZero(size) => {
                        size.bytes().into()
                    }
                    Load::VectorExtend(..) => Type::I64.bytes(),
                    Load::Full => function.type_of(value).bytes(),
                };
                (address, offset, size, access)
            }
            Op::Store {
                kind,
                args: [stored, address],
                offset,
                access,
            } => {
                let size = match kind {
                    Store::Narrow(size) => size.bytes().into(),
                    Store::Full => function.type_of(stored).bytes(),
                };
                (address, offset, size, access)
            }
            Op::LoadLane {
                lanes,
                args: [_, address],
                offset,
                access,
                ..
            }
            | Op::StoreLane {
                lanes,
                args: [_, address],
                offset,
                access,
                ..
            } => (address, offset, lanes.bytes().into(), access),
            _ => return None,
        };
        (!access.has(AccessFlags::ATOMIC)).then(|| Self {
            address: Address::new(function, address, offset),
            size,
        })
    }

    /// While the values that they are computed from stay the same.
    pub(super) fn is_apart_from(&self, function: &Function, other: &Self) -> bool {
        let (a, b) = (&self.address, &other.address);
        if (a.base, a.index, a.shift) == (b.base, b.index, b.shift) {
            let distance = b.low_distance().wrapping_sub(a.low_distance());
            return distance >= self.size as i32 || distance <= -(other.size as i32);
        }
        let is_slot =
            |base: Value| !base.is_none() && matches!(function.op(base), Op::SlotAddress(_));
        a.base != b.base && is_slot(a.base) && is_slot(b.base)
    }

    /// The `size` bytes that begin `distance` bytes after this place begins.
    pub(super) fn at_distance(&self, distance: i64, size: u32) -> Option<Self> {
        let offset = self.address.offset.checked_add(distance)?;
        let address = Address {
            offset,
            ..self.address
        };
        Some(Self { address, size })
    }

    pub(super) fn covers(&self, other: &Self) -> bool {
        let distance = other.address.offset.wrapping_sub(self.address.offset);
        let moved = Address {
            offset: self.address.offset,
            ..other.address
        };
        moved == self.address
            && other.size <= self.size
            && (0..=i64::from(self.size - other.size)).contains(&distance)
    }
}
