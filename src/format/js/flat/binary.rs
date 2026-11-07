//! Binary and logical expressions that are too wide for the line, and the conditions of statements.

use super::holes::Hole;
use super::*;
use crate::js::print::binary_like_expression::{BinaryLayout, BinaryLikeExpression};

/// The operator and the right side of `node`, which is part of a chain: the `+ c` of `a + b + c`.
#[derive(Copy, Clone)]
struct Operand<'a> {
    node: Expr<'a>,
    operator: BinOp,
    right: Expr<'a>,
}

/// True if both are logical expressions, or both are binary expressions.
fn is_same_kind(e: Expr<'_>, operator: BinOp) -> bool {
    e.binary_op()
        .is_some_and(|other| other != BinOp::Comma && other.is_logical() == operator.is_logical())
}

impl<'a> Line<'_, 'a> {
    /// What's between the parentheses of `if (..) {` and `while (..) {`, which is too wide for their line.
    pub(super) fn condition_too_wide(&mut self, test: Expr<'a>) -> Written {
        // `!(a && b)` starts on the line of the statement.
        if test.tag() == ExprTag::Unary || self.can_have_assertion(test) {
            return Err(Refused);
        }
        self.has_measured = true;
        self.break_line(1)?;
        match test.binary_op() {
            // Its operands break together with the parentheses.
            Some(operator) if operator != BinOp::Comma => self.operands(test, true, false, 0)?,
            _ => self.operand(test, 0)?,
        }
        self.break_line(-1)
    }

    /// Writes `e`, which `tail` columns and a line break follow, where it can need parentheses.
    fn operand(&mut self, e: Expr<'a>, tail: usize) -> Written {
        // It has a group of its own at the end of a chain.
        if e.tag() == ExprTag::Jsx {
            return Err(Refused);
        }
        self.expr_in_place_before_line_break(e, Place::Other, tail)
    }

    /// The binary or logical expression `e`, which doesn't need parentheses and is too wide for the line, with nothing
    /// but closing brackets after it.
    pub(super) fn binary_too_wide(&mut self, e: Expr<'a>) -> Written {
        let binary = BinaryLikeExpression::new(e).ok_or(Refused)?;
        let tail = self.tail;
        match binary.layout(self.f) {
            BinaryLayout::Plain => match e.parent() {
                // In parentheses that are there if it breaks.
                Node::Stmt(statement)
                    if matches!(statement.tag(), StmtTag::Return | StmtTag::Throw) =>
                {
                    self.byte(b'(')?;
                    self.break_line(1)?;
                    self.fits_or_breaks(0, &|line| match line.breaks {
                        true => line.operands(e, false, false, 0),
                        false => line.expr_of(ExprTag::Binary, e),
                    })?;
                    self.break_line(-1)?;
                    self.byte(b')')
                }
                Node::VarDecl(_) | Node::Prop(_) | Node::Member(_) | Node::Func(_) => {
                    self.operands(e, false, false, tail)
                }
                Node::Expr(parent) if matches!(parent.tag(), ExprTag::Assign | ExprTag::Cond) => {
                    self.operands(e, false, false, tail)
                }
                _ => Err(Refused),
            },
            BinaryLayout::Indented => self.operands(e, false, true, tail),
            BinaryLayout::Condition | BinaryLayout::Parentheses => Err(Refused),
        }
    }

    /// The operands of the chain that `e` is the whole of, each on a line. `tail` columns follow the last.
    fn operands(&mut self, e: Expr<'a>, in_condition: bool, indents: bool, tail: usize) -> Written {
        if !(self.f.options().experimental_operator_position).is_end() {
            return Err(Refused);
        }
        let mut operands = SmallVec::<[Operand<'a>; 6]>::new();
        let mut node = e;
        let first = loop {
            let (operator, left, right) = node.as_binary().ok_or(Refused)?;
            // `a && (b && c)` is part of the chain, an object or an array after `&&` stays on its line, and so does
            // what follows `a < b >`.
            if operator == BinOp::Comma
                || right.binary_op() == Some(operator)
                || (operator.is_logical()
                    && matches!(right.tag(), ExprTag::Object | ExprTag::Array))
                || (operator == BinOp::Gt && left.binary_op() == Some(BinOp::Lt))
            {
                return Err(Refused);
            }
            operands.push(Operand {
                node,
                operator,
                right,
            });
            match left.binary_op() {
                Some(left_operator)
                    if left_operator != BinOp::Comma && should_flatten(operator, left_operator) =>
                {
                    node = left;
                }
                _ => break left,
            }
        };
        operands.reverse();
        let width_of = |operand: Option<&Operand<'a>>| {
            operand.map_or(tail, |it| 1 + bin_op_text(it.operator).len())
        };
        self.operand(first, width_of(operands.first()))?;
        // The first one is in a group of its own.
        if let Some(part) = self.parts.last_mut()
            && matches!(part, Part::Expr(e) if *e == first)
        {
            *part = Part::Hole(Hole::Expr(first, true));
        }
        let mut is_indented = false;
        let mut left = first;
        for (index, operand) in operands.iter().enumerate() {
            let Operand {
                node,
                operator,
                right,
            } = *operand;
            let after = width_of(operands.get(index + 1));
            self.byte(b' ')?;
            self.token(bin_op_text(operator))?;
            // The operator and the right side are a group of their own unless they're part of a longer chain.
            let is_group = !(matches!(node.parent(), Node::Expr(parent) if is_same_kind(parent, operator))
                || is_same_kind(left, operator)
                || is_same_kind(right, operator)
                || (in_condition && operator.is_logical()));
            left = node;
            if is_group && self.width == Width::Unknown {
                return Err(Refused);
            }
            if is_group && self.width == Width::Known {
                let mark = self.spot();
                let breaks = std::mem::replace(&mut self.breaks, false);
                let written = (self.byte(b' '))
                    .and_then(|()| self.expr(right, Place::Other))
                    .and_then(|()| self.check_room_for(after));
                self.breaks = breaks;
                if written.is_ok() {
                    continue;
                }
                if !self.is_certain || !self.is_first_line_too_wide(mark) {
                    return Err(Refused);
                }
                self.back_to(mark);
                self.has_measured = true;
            }
            self.break_line(i8::from(indents && !is_indented))?;
            is_indented = indents;
            self.operand(right, after)?;
        }
        match is_indented {
            true => self.outdent(),
            false => Ok(()),
        }
    }
}
