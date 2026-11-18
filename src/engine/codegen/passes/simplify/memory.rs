//! Addresses, and what is loaded and stored.

use bun_engine_asm::{Sign, Size};

use super::Simplifier;
use super::rewrite::Step;
use crate::ir::{Access, AccessFlags, Lanes, Load, Op, Store, Type, Unary, Value};

impl Simplifier<'_> {
    pub(super) fn access(&mut self, mut op: Op) -> Step {
        match &mut op {
            Op::Load {
                address, offset, ..
            }
            | Op::Store {
                args: [_, address],
                offset,
                ..
            }
            | Op::LoadLane {
                args: [_, address],
                offset,
                ..
            }
            | Op::StoreLane {
                args: [_, address],
                offset,
                ..
            } => {
                if let Some(folded) = self.fold_address(*address, *offset) {
                    (*address, *offset) = folded;
                    return Step::To(op);
                }
            }
            Op::AtomicUpdate {
                size,
                args: [operand, _],
                ..
            } => {
                if self.strip_in_place(operand, *size) {
                    return self.to(op);
                }
            }
            Op::AtomicCompareExchange {
                size,
                args: [expected, replacement, _],
                ..
            } => {
                if self.strip_in_place(expected, *size) || self.strip_in_place(replacement, *size) {
                    return self.to(op);
                }
            }
            _ => unreachable!("not an access"),
        }
        match op {
            Op::Store {
                kind,
                args: [stored, address],
                offset,
                access,
            } => self.store(kind, stored, address, offset, access),
            _ => Step::Keep,
        }
    }

    fn strip_in_place(&mut self, operand: &mut Value, size: Size) -> bool {
        let stripped = self.strip_above(*operand, size.bits());
        *operand = stripped.unwrap_or(*operand);
        stripped.is_some()
    }

    fn fold_address(&mut self, address: Value, offset: i32) -> Option<(Value, i32)> {
        if let Some((base, distance)) = self.as_offset(address) {
            let sum = i32::try_from(distance.checked_add(offset.into())?).ok()?;
            self.hit();
            return Some((base, sum));
        }
        let constant = self.int(address).filter(|_| offset != 0)?;
        self.hit();
        Some((
            self.int_like(address, constant.wrapping_add(offset.into())),
            0,
        ))
    }

    fn store(
        &mut self,
        kind: Store,
        stored: Value,
        address: Value,
        offset: i32,
        access: Access,
    ) -> Step {
        let store = |kind, stored| Op::Store {
            kind,
            args: [stored, address],
            offset,
            access,
        };
        let ty = self.type_of(stored);
        if let Store::Narrow(size) = kind {
            if ty == Type::I64 {
                let low = self.make_wrap(stored);
                return self.to(store(
                    if size == Size::S32 { Store::Full } else { kind },
                    low,
                ));
            }
            if let Some(stripped) = self.strip_above(stored, size.bits()) {
                return self.to(store(kind, stripped));
            }
        }
        if access.has(AccessFlags::ATOMIC) {
            return Step::Keep;
        }
        match self.op(stored) {
            Op::Unary(Unary::Bitcast, original) if kind == Store::Full => {
                self.to(store(kind, original))
            }
            Op::ConstF32(bits) => {
                let bits = self.constant(Type::I32, bits.into());
                self.to(store(kind, bits))
            }
            Op::ConstF64(bits) => {
                let bits = self.constant(Type::I64, bits.get());
                self.to(store(kind, bits))
            }
            Op::ExtractLane {
                lanes,
                lane,
                vector,
                ..
            } if self.once(stored) => {
                let size = match lanes {
                    Lanes::Int(size) => size,
                    Lanes::Float(width) => width.width().size(),
                };
                let written = if let Store::Narrow(size) = kind {
                    size
                } else {
                    ty.width().size()
                };
                if size != written {
                    return Step::Keep;
                }
                self.to(Op::StoreLane {
                    lanes: size,
                    lane,
                    args: [vector, address],
                    offset,
                    access,
                })
            }
            _ => Step::Keep,
        }
    }

    /// Puts `new` in the place of a load that is about to lose its last use. If that one may trap, so does `new`.
    pub(super) fn load_instead(&mut self, old: Value, new: Op, ty: Type) -> Value {
        let value = self.insert_before(old, new, ty);
        if let Op::Load { access, .. } = self.function.op_mut(old) {
            *access = Access::new(access.heap(), access.flags() - AccessFlags::TRAPS);
        }
        value
    }

    /// The number of bytes that a load of a scalar reads, if it may become another load of them.
    pub(super) fn bytes_loaded_once(&self, load: Value) -> Option<u32> {
        match self.op(load) {
            Op::Load { access, .. } if access.has(AccessFlags::ATOMIC) || !self.once(load) => None,
            Op::Load {
                kind: Load::Narrow(size, _),
                ..
            } => Some(size.bytes().into()),
            Op::Load {
                kind: Load::Full, ..
            } => Some(self.type_of(load).bytes()),
            _ => None,
        }
    }

    /// An integer from some of the bytes that a load reads, which is wanted for nothing else.
    pub(super) fn load_part(
        &mut self,
        load: Value,
        skipped: u32,
        size: Size,
        sign: Sign,
    ) -> Option<Value> {
        let kind = if size < Size::S32 {
            Load::Narrow(size, sign)
        } else {
            Load::Full
        };
        self.load_part_as(load, skipped, size, kind, size.width().into())
    }

    pub(super) fn load_part_as(
        &mut self,
        load: Value,
        skipped: u32,
        size: Size,
        kind: Load,
        ty: Type,
    ) -> Option<Value> {
        let (available, wanted) = (self.bytes_loaded_once(load)?, u32::from(size.bytes()));
        let Op::Load {
            address,
            offset,
            access,
            ..
        } = self.op(load)
        else {
            unreachable!("not a load")
        };
        if skipped + wanted > available || wanted < available && access.has(AccessFlags::TRAPS) {
            return None;
        }
        let offset = offset.checked_add(skipped as i32)?;
        Some(self.load_instead(
            load,
            Op::Load {
                kind,
                address,
                offset,
                access,
            },
            ty,
        ))
    }
}
