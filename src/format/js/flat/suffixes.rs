//! What follows an expression that can end the line, and can't break itself: `a(..)!`, `{..} as T`, `a(..).b`,
//! `a(..)[0]`.

use super::*;
use crate::js::utils::assignment_like::is_type_without_line_breaks;

impl<'a> Line<'_, 'a> {
    /// How wide what `write` writes is. Nothing stays written.
    pub(super) fn width_of(
        &mut self,
        write: impl FnOnce(&mut Self) -> Written,
    ) -> Result<usize, Refused> {
        let mark = self.spot();
        let breaks = self.breaks;
        (self.breaks, self.limit) = (false, usize::MAX);
        let written = write(self);
        let width = self.len - mark.len;
        let has_parts = self.parts.len() != mark.parts;
        self.back_to(mark);
        self.breaks = breaks;
        match has_parts {
            true => Err(Refused),
            false => written.map(|()| width),
        }
    }

    /// Returns what `e` is a suffix of, if that's an expression that can end the line.
    #[inline]
    pub(super) fn before_suffix(&self, e: Expr<'a>) -> Option<Expr<'a>> {
        match e.tag() {
            ExprTag::As
            | ExprTag::AsConst
            | ExprTag::Satisfies
            | ExprTag::NonNull
            | ExprTag::Dot
            | ExprTag::Index => self.before_suffix_of(e),
            _ => None,
        }
    }

    #[inline(never)]
    fn before_suffix_of(&self, e: Expr<'a>) -> Option<Expr<'a>> {
        let inner = self.without_suffix(e)?;
        let mut base = inner;
        loop {
            base = match base.tag() {
                ExprTag::Call | ExprTag::New | ExprTag::Object | ExprTag::Array => {
                    return Some(inner);
                }
                _ => self.without_suffix(base)?,
            };
        }
    }

    /// Returns `e` without its last suffix, if that can't break.
    fn without_suffix(&self, e: Expr<'a>) -> Option<Expr<'a>> {
        Some(match e.kind() {
            ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty }
                if !e.is_angle_bracket_assertion() && is_type_without_line_breaks(ty, self.f) =>
            {
                expr
            }
            ExprKind::AsConst(expr) if !e.is_angle_bracket_assertion() => expr,
            ExprKind::NonNull(expr) if e.non_null_count() == 1 && !e.is_chain_root() => expr,
            // There's no line break before the `.` after a call with arguments that's assigned.
            ExprKind::Dot { obj, .. }
                if matches!(obj.tag(), ExprTag::Call | ExprTag::NonNull) && !e.is_chain_root() =>
            {
                let mut outer = e.parent();
                while let Node::Expr(parent) = outer
                    && parent.tag() == ExprTag::NonNull
                    && !parent.is_chain_root()
                {
                    outer = parent.parent();
                }
                let is_assigned = match outer {
                    Node::VarDecl(_) => true,
                    Node::Expr(parent) => parent.tag() == ExprTag::Assign,
                    _ => false,
                };
                let mut call = obj;
                while let (ExprTag::NonNull, Some(operand)) = (call.tag(), call.operand()) {
                    call = operand;
                }
                let has_arguments = call.as_call().is_some_and(|it| !it.args().is_empty());
                if !is_assigned || !has_arguments || obj.is_chain_root() {
                    return None;
                }
                obj
            }
            ExprKind::Index { obj, index, .. }
                if !e.is_chain_root() && index.tag() == ExprTag::Number =>
            {
                obj
            }
            _ => return None,
        })
    }

    /// `e`, which is `inner` and a suffix, with nothing but closing brackets after it.
    pub(super) fn with_suffix(&mut self, e: Expr<'a>, inner: Expr<'a>) -> Written {
        let width = self.width_of(|line| line.suffix(e))?;
        let place = match e.tag() {
            ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies => Place::Other,
            _ => Place::Object,
        };
        self.tail += width;
        let written = self.last_expr(inner, place);
        self.tail -= width;
        written?;
        self.suffix(e)
    }

    fn suffix(&mut self, e: Expr<'a>) -> Written {
        match e.kind() {
            ExprKind::As { ty, .. } => {
                self.token(" as ")?;
                self.ty(ty)
            }
            ExprKind::Satisfies { ty, .. } => {
                self.token(" satisfies ")?;
                self.ty(ty)
            }
            ExprKind::AsConst(_) => self.token(" as const"),
            ExprKind::NonNull(_) => self.byte(b'!'),
            ExprKind::Dot { name, chain, .. } => {
                self.token(match chain {
                    Chain::Start => "?.",
                    _ => ".",
                })?;
                self.source(name.span())
            }
            ExprKind::Index { index, chain, .. } => {
                self.token(match chain {
                    Chain::Start => "?.[",
                    _ => "[",
                })?;
                self.expr(index, Place::Free)?;
                self.byte(b']')
            }
            _ => Err(Refused),
        }
    }
}
