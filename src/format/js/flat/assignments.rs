//! The right side of `=` or `:` where the line is too wide.

use super::*;
use crate::js::utils::assignment_like::{
    AssignmentLike, AssignmentLikeLayout, has_short_key, is_type_without_line_breaks,
};

impl<'a> Line<'_, 'a> {
    /// Where the assignment that `value` is the right side of breaks if it's too wide. The left side is on one line,
    /// unless `is_left_broken`.
    fn layout_of_assignment(
        &mut self,
        value: Expr<'a>,
        is_left_broken: bool,
    ) -> Result<AssignmentLikeLayout, Refused> {
        let is_text = |ty: Option<TypeNode<'a>>, f: &Formatter<'a>| match ty {
            Some(ty) if !is_type_without_line_breaks(ty, f) => None,
            _ => Some(false),
        };
        let mut is_left_short = false;
        // Whether something in the left side can break, if that's known.
        let (assignment, left_may_break) = match value.parent() {
            Node::VarDecl(declarator) => (
                AssignmentLike::VariableDeclarator(declarator),
                match declarator.pat().kind() {
                    PatKind::Ident(_) => is_text(declarator.ty(), self.f),
                    PatKind::Object(props) if !props.is_empty() => Some(true),
                    PatKind::Array(elements) if !elements.is_empty() => Some(true),
                    _ => None,
                },
            ),
            Node::Expr(assignment) if assignment.tag() == ExprTag::Assign => {
                let mut target = assignment.left().ok_or(Refused)?;
                while target.tag() == ExprTag::Dot {
                    target = target.object().ok_or(Refused)?;
                }
                (
                    AssignmentLike::AssignmentExpression(assignment),
                    matches!(target.tag(), ExprTag::Ident | ExprTag::This).then_some(false),
                )
            }
            Node::Prop(property) => {
                let key = property.key().ok_or(Refused)?;
                is_left_short = has_short_key(property, self.f);
                (
                    AssignmentLike::ObjectProperty(property),
                    (!matches!(key.kind(), KeyKind::Computed(_))).then_some(false),
                )
            }
            Node::Member(member)
                if matches!(member.as_ast_nodes(), AstNodes::PropertyDefinition(_)) =>
            {
                // The line can break after a decorator and in a computed key.
                let can_break = (member.modifiers().iter()).any(|it| it.decorator().is_some())
                    || (member.key()).is_some_and(|key| matches!(key.kind(), KeyKind::Computed(_)));
                (
                    AssignmentLike::PropertyDefinition(member),
                    is_text(member.ty(), self.f).filter(|_| !can_break),
                )
            }
            _ => return Err(Refused),
        };
        let layout = assignment.layout_of(is_left_short, left_may_break.unwrap_or(false), self.f);
        if left_may_break.is_none() && layout != assignment.layout_of(is_left_short, true, self.f) {
            return Err(Refused);
        }
        // There the left side breaks first.
        match layout == AssignmentLikeLayout::BreakLeftHandSide
            && left_may_break != Some(false)
            && !is_left_broken
        {
            true => Err(Refused),
            false => Ok(layout),
        }
    }

    /// The right side of the `=` after a pattern, with nothing but closing brackets after it.
    pub(super) fn assigned_to_pattern(&mut self, value: Expr<'a>) -> Written {
        // After a pattern that's broken.
        if self.breaks && !self.parts.is_empty() {
            if value.tag() == ExprTag::Assign {
                return Err(Refused);
            }
            return self.fits_or_breaks(self.tail, &|line| match line.breaks {
                true => line.assigned_too_wide_after(value, true),
                false => line.last_expr(value, Place::Free),
            });
        }
        if self.breaks {
            return self.last_assigned(value);
        }
        let mark = self.spot();
        self.is_too_wide = false;
        if self.assigned(value).is_ok() {
            return Ok(());
        }
        if self.is_too_wide {
            return Err(Refused);
        }
        self.back_to(mark);
        // A pattern that has no group of its own breaks together with the right side.
        match self.layout_of_assignment(value, false)? {
            AssignmentLikeLayout::Fluid | AssignmentLikeLayout::NeverBreakAfterOperator => {
                self.last_assigned(value)
            }
            _ => Err(Refused),
        }
    }

    /// The right side of `=` or `:`, which has been written with a space after it, where all of it is too wide for the
    /// line.
    pub(super) fn assigned_too_wide(&mut self, value: Expr<'a>) -> Written {
        self.assigned_too_wide_after(value, false)
    }

    /// What `declarator` declares, in a declaration that starts the line.
    pub(super) fn declared(&mut self, declarator: VarDecl<'a>) -> Written {
        let pattern = declarator.pat();
        let (true, PatKind::Object(props), Some(init), None) = (
            self.breaks,
            pattern.kind(),
            declarator.init(),
            declarator.ty(),
        ) else {
            return self.pattern(pattern);
        };
        if props.is_empty() {
            return self.pattern(pattern);
        }
        // It breaks together with the declaration, or it's a group of its own, which the ` =` follows.
        if self.layout_of_assignment(init, true)? != AssignmentLikeLayout::BreakLeftHandSide {
            let mark = self.spot();
            self.is_too_wide = false;
            let written = (self.pattern(pattern)).and_then(|()| self.check_room_for(" =".len()));
            if written.is_ok() || !self.is_first_line_too_wide(mark) {
                return written;
            }
            self.back_to(mark);
        }
        // Nothing can follow a rest element.
        let has_last_comma =
            self.has_trailing_comma(false) && !props.last().is_some_and(PatProp::is_rest);
        self.byte(b'{')?;
        self.lines(props.len(), props.iter(), has_last_comma, |line, prop| {
            line.pattern_property(prop)
        })?;
        self.byte(b'}')
    }

    fn assigned_too_wide_after(&mut self, value: Expr<'a>, is_left_broken: bool) -> Written {
        if self.width != Width::Known {
            return Err(Refused);
        }
        match self.layout_of_assignment(value, is_left_broken)? {
            AssignmentLikeLayout::BreakAfterOperator => self.assigned_on_next_line(value),
            AssignmentLikeLayout::NeverBreakAfterOperator
            | AssignmentLikeLayout::BreakLeftHandSide => self.last_expr(value, Place::Free),
            AssignmentLikeLayout::Fluid if is_unbreakable(value.tag()) => {
                match self.never_breaks(value) {
                    true => self.assigned_on_next_line(value),
                    false => Err(Refused),
                }
            }
            AssignmentLikeLayout::Fluid => {
                let mark = self.spot();
                self.is_too_wide = false;
                let must_fit = std::mem::replace(&mut self.must_fit, mark.parts);
                let written = self.last_expr(value, Place::Free);
                self.must_fit = must_fit;
                if written.is_ok() {
                    // It has to be known that it fits up to where it can break first.
                    return match self.is_first_line_known(mark) {
                        true => Ok(()),
                        false => Err(Refused),
                    };
                }
                // It moves to the next line if it doesn't fit up to where it can break first.
                if !self.is_first_line_too_wide(mark) || !self.breaks_first_at_end_of_line(value) {
                    return Err(Refused);
                }
                self.back_to(mark);
                self.assigned_on_next_line(value)
            }
            _ => Err(Refused),
        }
    }

    fn assigned_on_next_line(&mut self, value: Expr<'a>) -> Written {
        // An arrow function is told about the layout. An empty line that's kept is a line break up to which it can fit.
        if value.tag() == ExprTag::Fn || has_empty_line(self.text_of(value.outer_span())) {
            return Err(Refused);
        }
        // The space after the operator.
        if self.len <= self.start {
            return Err(Refused);
        }
        self.len -= 1;
        self.break_line(1)?;
        self.expr_before_line_break(value, self.tail)?;
        self.outdent()
    }

    /// True if the first line of `value`, written with all the line breaks that there can be, ends where the first of
    /// them is: `a(`, `a.b(`, `new A(`, `await a(`, `{`, `[`.
    fn breaks_first_at_end_of_line(&mut self, mut value: Expr<'a>) -> bool {
        let whole = value;
        loop {
            // What's in parentheses has been written on one line, so that says nothing about where it breaks first.
            if value != whole && needs_parentheses(value, self.f) {
                return false;
            }
            if let Some(inner) = self.before_suffix(value) {
                value = inner;
                continue;
            }
            value = match value.kind() {
                ExprKind::Await(argument) => argument,
                ExprKind::Object(_) | ExprKind::Array(_) => return true,
                ExprKind::Cond { test, .. } => return self.never_breaks(test),
                ExprKind::Call(call) | ExprKind::New(call) => {
                    let callee = call.callee();
                    let mut root = callee;
                    while root.tag() == ExprTag::Dot {
                        match root.object() {
                            Some(object) => root = object,
                            None => return false,
                        }
                    }
                    // `Line::call` writes the arguments of `this(..)` on one line.
                    return !call.args().is_empty()
                        && call.type_args().is_empty()
                        && (root.tag() == ExprTag::Ident
                            || (root.tag() == ExprTag::This && root != callee));
                }
                _ => return false,
            };
        }
    }
}
