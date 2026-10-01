//! PROTOTYPE of src/lint/rules/for_direction.rs. Ported from ESLint lib/rules/for-direction.js.

use bun_ast::{Expr, ExprData, Loc, OpCode, S};

use crate::dupe::Ctx;
use crate::eslint_utils::{self, StaticValue};

pub const MESSAGE: &str = "The update clause in this loop moves the variable in the wrong direction.";

/// The name of the identifier that ESLint has at the place of `place`.
fn identifier_name<'a>(ctx: &Ctx<'_, 'a>, place: &Expr) -> Option<&'a [u8]> {
    match &ctx.plain(place)?.data {
        ExprData::EIdentifier(identifier) => Some(ctx.parsed.name_of(identifier.ref_)),
        _ => None,
    }
}

/// `getRightDirection`: `dir`, turned around by a negative step; 0 where the step is zero, NaN or not known.
fn get_right_direction(ctx: &Ctx<'_, '_>, right: &Expr, dir: i32) -> i32 {
    let sign = match eslint_utils::get_static_value(ctx, right) {
        Some(StaticValue::Number(number)) => i32::from(number > 0.0) - i32::from(number < 0.0),
        Some(StaticValue::BigInt(big)) => i32::from(big > 0) - i32::from(big < 0),
        Some(StaticValue::Boolean(boolean)) => i32::from(boolean),
        _ => 0,
    };
    dir * sign
}

/// `getModifyingExpressions`: how many expressions of the update change `counter`, and `getDirectionFromExpression` of the first.
fn modifying(ctx: &Ctx<'_, '_>, update: &Expr, counter: &[u8]) -> (u32, i32) {
    let mut count = 0u32;
    let mut direction = 0;
    let mut stack = vec![update];
    while let Some(place) = stack.pop() {
        let Some(node) = ctx.plain(place) else { continue };
        let found = match &node.data {
            ExprData::EBinary(binary) if binary.op == OpCode::BinComma => {
                stack.push(&binary.right);
                stack.push(&binary.left);
                continue;
            }
            ExprData::EUnary(unary) if identifier_name(ctx, &unary.value) == Some(counter) => match unary.op {
                OpCode::UnPreInc | OpCode::UnPostInc => 1,
                OpCode::UnPreDec | OpCode::UnPostDec => -1,
                _ => continue,
            },
            ExprData::EBinary(binary) if (binary.op as u8) >= (OpCode::BinAssign as u8) && identifier_name(ctx, &binary.left) == Some(counter) => match binary.op {
                OpCode::BinAddAssign => get_right_direction(ctx, &binary.right, 1),
                OpCode::BinSubAssign => get_right_direction(ctx, &binary.right, -1),
                _ => 0,
            },
            _ => continue,
        };
        count += 1;
        if count == 1 {
            direction = found;
        }
    }
    (count, direction)
}

/// The `ForStatement` handler: reported at the `for`, once for each side of the test whose counter moves away from the bound.
pub fn s_for(ctx: &mut Ctx<'_, '_>, node: &S::For, loc: Loc) {
    let (Some(test), Some(update)) = (&node.test, &node.update) else { return };
    let Some(ExprData::EBinary(test)) = ctx.plain(test).map(|test| &test.data) else { return };
    // The wrong direction of a counter on the left of the operator.
    let wrong = match test.op {
        OpCode::BinLt | OpCode::BinLe => -1,
        OpCode::BinGt | OpCode::BinGe => 1,
        _ => return,
    };
    for (operand, wrong) in [(&test.left, wrong), (&test.right, -wrong)] {
        let Some(counter) = identifier_name(ctx, operand) else { continue };
        if modifying(ctx, update, counter) == (1, wrong) {
            ctx.reports.push(("for-direction", loc.start as u32, MESSAGE.as_bytes().to_vec()));
        }
    }
}
