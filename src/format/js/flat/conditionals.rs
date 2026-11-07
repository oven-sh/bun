//! Conditional expressions that are too wide for the line.

use super::*;
use crate::js::utils::conditional::is_jsx_conditional_chain;

impl<'a> Line<'_, 'a> {
    /// The conditional expression `e`, which doesn't need parentheses, isn't part of another one and is too wide for the
    /// line, with nothing but closing brackets after it.
    pub(super) fn conditional_too_wide(&mut self, e: Expr<'a>) -> Written {
        let (test, yes, no) = e.as_cond().ok_or(Refused)?;
        let is_known_parent = match e.parent() {
            Node::VarDecl(_) | Node::Prop(_) | Node::Member(_) | Node::Func(_) => true,
            Node::Stmt(statement) => matches!(
                statement.tag(),
                StmtTag::Return | StmtTag::Throw | StmtTag::Expr
            ),
            Node::Expr(parent) => match parent.tag() {
                ExprTag::Assign => parent.right() == Some(e),
                ExprTag::Call | ExprTag::New => parent.callee() != Some(e),
                _ => false,
            },
            _ => false,
        };
        if !is_known_parent || test.tag() == ExprTag::Cond || is_jsx_conditional_chain(e) {
            return Err(Refused);
        }
        let tail = self.tail;
        self.expr_in_place_before_line_break(test, Place::Other, 0)?;
        self.break_line(1)?;
        self.token("? ")?;
        self.branch(yes, 0)?;
        self.break_line(0)?;
        self.token(": ")?;
        self.branch(no, tail)?;
        self.outdent()
    }

    /// What follows the `?` or the `:`, on one line if that fits. `tail` columns follow it.
    fn branch(&mut self, e: Expr<'a>, tail: usize) -> Written {
        let span = e.outer_span();
        self.check_source_up_to(span.start)?;
        // A conditional expression in here breaks together with the one around it.
        if e.tag() != ExprTag::Cond {
            let mark = self.spot();
            let breaks = std::mem::replace(&mut self.breaks, false);
            let written = (self.expr(e, Place::Other))
                .and_then(|()| self.check_room_for(tail))
                .and_then(|()| self.check_source_up_to(span.end));
            self.breaks = breaks;
            if written.is_ok() {
                return Ok(());
            }
            self.back_to(mark);
            self.has_measured = true;
        }
        self.check_parentheses(e)?;
        self.check_measured(span)?;
        self.end_text(None)?;
        self.parts.push(Part::Aligned(e));
        self.checked_to = span.end;
        self.start_line_of_unknown_width();
        Ok(())
    }
}
