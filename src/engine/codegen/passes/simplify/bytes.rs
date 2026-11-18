//! Shifts and masks that put the bytes of one value in another order.

use bun_engine_asm::Size;

use super::Simplifier;
use super::facts::all_ones;
use super::rewrite::Step;
use crate::ir::Binary::{And, Or, RotateRight, Shl, Shr};
use crate::ir::Unary::SwapBytes;
use crate::ir::{Op, Type, Value, evaluate};

/// Each byte is the number, from one, of the byte of the source that is in its place, or zero for a byte that is zero.
/// Operations that move bytes do the same to these numbers.
type Order = u64;

const UNCHANGED: Order = 0x0807_0605_0403_0201;

fn occupied(order: Order) -> u64 {
    u64::from_le_bytes(
        order
            .to_le_bytes()
            .map(|byte| if byte == 0 { 0 } else { 0xff }),
    )
}

impl Simplifier<'_> {
    fn order_of_bytes(&self, value: Value, depth: u32) -> (Value, Order) {
        let ty = self.type_of(value);
        let moved = depth.checked_sub(1).and_then(|depth| match self.op(value) {
            Op::Binary(Or, [a, b]) => {
                let (source, first) = self.order_of_bytes(a, depth);
                let (same, second) = self.order_of_bytes(b, depth);
                (source == same && occupied(first) & second == 0)
                    .then_some((source, first | second))
            }
            Op::Binary(op @ (And | Shl | Shr | RotateRight), [a, constant]) => {
                let constant = self.bits(constant)?;
                let keeps_bytes = if op == And {
                    occupied(constant) == constant
                } else {
                    constant % 8 == 0
                };
                let (source, order) = keeps_bytes.then(|| self.order_of_bytes(a, depth))?;
                Some((source, evaluate::binary(op, ty, order, constant)?))
            }
            Op::Unary(op @ SwapBytes(_), a) => {
                let (source, order) = self.order_of_bytes(a, depth);
                Some((source, evaluate::unary(op, ty, ty, order)?))
            }
            _ => None,
        });
        moved.unwrap_or_else(|| (value, UNCHANGED & all_ones(ty.width())))
    }

    pub(super) fn or_of_bytes(&mut self, ty: Type, a: Value, b: Value) -> Option<Step> {
        const DEPTH: u32 = 5;
        let moves_bytes = |value| {
            matches!(
                self.op(value),
                Op::Binary(Or | And | Shl | Shr | RotateRight, _) | Op::Unary(SwapBytes(_), _)
            )
        };
        if !moves_bytes(a) || !moves_bytes(b) {
            return None;
        }
        let ((source, first), (same, second)) =
            (self.order_of_bytes(a, DEPTH), self.order_of_bytes(b, DEPTH));
        if source != same || occupied(first) & second != 0 {
            return None;
        }
        let sizes = [Size::S16, Size::S32, Size::S64].into_iter();
        let mut sizes = sizes.filter(|&size| size <= ty.width().size());
        let swapped = |size| evaluate::unary(SwapBytes(size), Type::I64, Type::I64, UNCHANGED);
        let size = sizes.find(|&size| swapped(size) == Some(first | second))?;
        Some(self.to_unary(SwapBytes(size), source))
    }
}
