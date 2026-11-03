//! Plain expressions: names, `this`, literals, member accesses and calls of those, and operators between them.
//!
//! They're most of what's in a line, and all there is to know about them is in their records: the kind, where they start
//! and end. So they're written from the records ([`File::plain_expr`]), without handles. What's written is what
//! [`Line::expr`] writes. Whatever isn't plain is left to it.

use super::*;
use bun_sema::hir::{self, ExprId};

/// How many links a chain of member accesses and calls can have here.
const MAX_LINKS: u32 = 24;

/// True for a name that needs parentheses in some places.
#[inline]
fn is_special_name(name: &[u8]) -> bool {
    match name.len() {
        3 => name == b"let",
        4 => name == b"type" || name == b"hook",
        5 => matches!(name, b"async" | b"await" | b"using" | b"yield"),
        6 => name == b"module",
        9 => name == b"interface" || name == b"component",
        _ => false,
    }
}

impl<'a> Line<'_, 'a> {
    /// Writes `e` if it's plain. Returns `None`, with nothing written, if it isn't.
    #[inline]
    pub(super) fn plain_expr(&mut self, e: Expr<'a>, place: Place) -> Option<Written> {
        let raw = self.f.file().plain_expr(e.id())?;
        self.plain(e.id(), raw, place, false)
    }

    /// [`Line::expr`] for what's directly in a statement other than `export default`, or in a `case`: a condition, say.
    #[inline]
    pub(super) fn expr_of_statement(&mut self, e: Expr<'a>) -> Written {
        let raw = self.f.file().plain_expr(e.id());
        match raw.and_then(|raw| self.plain(e.id(), raw, Place::Other, true)) {
            Some(written) => written,
            None => self.expr(e, Place::Other),
        }
    }

    /// `is_in_statement` as in [`Line::expr_of_statement`]: only a name, a sequence or `in` can need parentheses there.
    fn plain(
        &mut self,
        id: ExprId,
        raw: &hir::Expr,
        place: Place,
        is_in_statement: bool,
    ) -> Option<Written> {
        let file = self.f.file();
        let is_asked = !is_in_statement && place != Place::Free;
        match raw.kind {
            hir::ExprKind::Dot { .. } | hir::ExprKind::Call(_) | hir::ExprKind::Index { .. } => {
                if !self.is_plain_chain(id)
                    || (is_asked
                        && place == Place::Other
                        && needs_parentheses(file.handle_of_plain_expr(id), self.f))
                {
                    return None;
                }
                Some(self.plain_chain(id))
            }
            hir::ExprKind::Binary { op, left, right }
                if !matches!(op, BinOp::Comma | BinOp::In) =>
            {
                if is_asked && needs_parentheses(file.handle_of_plain_expr(id), self.f) {
                    return None;
                }
                Some(self.nested(|line| line.plain_binary(op, left, right)))
            }
            hir::ExprKind::Unary { op, operand } => {
                if is_asked && needs_parentheses(file.handle_of_plain_expr(id), self.f) {
                    return None;
                }
                Some(self.nested(|line| line.plain_unary(op, operand)))
            }
            _ => self.plain_leaf(raw, place),
        }
    }

    /// `left op right`, without parentheses.
    fn plain_binary(&mut self, op: BinOp, left: ExprId, right: ExprId) -> Written {
        let file = self.f.file();
        let left_raw = file.plain_expr(left).ok_or(Refused)?;
        let right_raw = file.plain_expr(right).ok_or(Refused)?;
        // `a && (b && c)` loses its parentheses.
        if matches!(right_raw.kind, hir::ExprKind::Binary { op: right_op, .. } if right_op == op) {
            return Err(Refused);
        }
        match left_raw.kind {
            // One chain, without the parentheses that `(a | b) | c` would get otherwise.
            hir::ExprKind::Binary {
                op: left_op,
                left,
                right,
            } if left_op != BinOp::Comma && should_flatten(op, left_op) => {
                self.nested(|line| line.plain_binary(left_op, left, right))?;
            }
            _ => self.plain_operand(left, left_raw, op, false)?,
        }
        self.byte(b' ')?;
        self.token(bin_op_text(op))?;
        self.byte(b' ')?;
        self.plain_operand(right, right_raw, op, true)
    }

    /// An operand of `parent`.
    fn plain_operand(
        &mut self,
        id: ExprId,
        raw: &hir::Expr,
        parent: BinOp,
        is_right: bool,
    ) -> Written {
        match raw.kind {
            hir::ExprKind::Binary { op, left, right }
                if !matches!(op, BinOp::Comma | BinOp::In) =>
            {
                let has_parentheses = match parent.is_logical() && op.is_logical() {
                    true => parent != op,
                    false => operand_needs_parentheses(parent, op, is_right),
                };
                if has_parentheses {
                    self.byte(b'(')?;
                }
                self.nested(|line| line.plain_binary(op, left, right))?;
                if has_parentheses {
                    self.byte(b')')?;
                }
                Ok(())
            }
            // `(-a) ** b`, `(!a) in b`
            hir::ExprKind::Unary { op, operand }
                if is_right || !matches!(parent, BinOp::Pow | BinOp::In | BinOp::Instanceof) =>
            {
                self.nested(|line| line.plain_unary(op, operand))
            }
            _ => self.plain_operand_of_any_operator(id, raw),
        }
    }

    /// `!operand`, `operand++`, without parentheses.
    fn plain_unary(&mut self, op: UnOp, operand: ExprId) -> Written {
        let raw = self.f.file().plain_expr(operand).ok_or(Refused)?;
        if op.is_update() && !op.is_prefix() {
            self.plain_operand_of_any_operator(operand, raw)?;
            return self.token(op.as_str());
        }
        self.token(op.as_str())?;
        if op.is_keyword() {
            self.byte(b' ')?;
        }
        self.plain_operand_of_any_operator(operand, raw)
    }

    /// No operator needs parentheses around a member access or a call.
    fn plain_operand_of_any_operator(&mut self, id: ExprId, raw: &hir::Expr) -> Written {
        match raw.kind {
            hir::ExprKind::Dot { .. } | hir::ExprKind::Call(_) | hir::ExprKind::Index { .. }
                if self.is_plain_chain(id) =>
            {
                self.plain_chain(id)
            }
            _ => match self.plain_leaf(raw, Place::Other) {
                Some(written) => written,
                None => {
                    let e = self.f.file().handle_of_plain_expr(id);
                    self.nested(|line| line.expr(e, Place::Other))
                }
            },
        }
    }

    /// [`Line::last_expr`] for an expression that `is_statement`, or else the argument of `return` or `throw`.
    #[inline]
    pub(super) fn last_expr_of_statement(&mut self, e: Expr<'a>, is_statement: bool) -> Written {
        match self.last_plain_expr(e.id(), Place::Other, is_statement) {
            Some(written) => written,
            None => self.last_expr(e, Place::Other),
        }
    }

    /// [`Line::last_assigned`]
    #[inline]
    pub(super) fn last_assigned_or_plain(&mut self, value: Expr<'a>) -> Written {
        match self.last_plain_expr(value.id(), Place::Free, false) {
            Some(written) => written,
            None => self.last_assigned(value),
        }
    }

    /// Writes an expression that ends its line, and that needs no parentheses where it is unless it's a name, if it's
    /// plain, or a plain assignment that `is_statement`.
    fn last_plain_expr(&mut self, id: ExprId, place: Place, is_statement: bool) -> Option<Written> {
        // What ends a line that's too wide is where it breaks.
        if self.breaks {
            return None;
        }
        let file = self.f.file();
        let raw = file.plain_expr(id)?;
        match raw.kind {
            hir::ExprKind::Call(call) => {
                // A function or an object as the last argument can end the line.
                if let Some(&last) = file.plain_list(file.plain_call(call)?.args).last()
                    && matches!(
                        file.plain_expr(ExprId(last))?.kind,
                        hir::ExprKind::Fn(_) | hir::ExprKind::Object(_)
                    )
                {
                    return None;
                }
                self.is_plain_chain(id).then(|| self.plain_chain(id))
            }
            // `a.b = c`, as a statement
            hir::ExprKind::Assign { op, target, value } if is_statement => {
                let target_raw = file.plain_expr(target)?;
                match target_raw.kind {
                    hir::ExprKind::Ident(_)
                        if !is_special_name(
                            self.text_of(Span::new(target_raw.pos, target_raw.end)),
                        ) => {}
                    hir::ExprKind::Dot { .. } | hir::ExprKind::Index { .. }
                        if self.is_plain_chain(target) => {}
                    _ => return None,
                }
                Some(self.plain_chain(target).and_then(|()| {
                    self.byte(b' ')?;
                    self.token(assign_op_text(op))?;
                    self.byte(b' ')?;
                    self.last_assigned_or_plain(file.handle_of_plain_expr(value))
                }))
            }
            hir::ExprKind::Dot { .. }
            | hir::ExprKind::Index { .. }
            | hir::ExprKind::Binary { .. }
            | hir::ExprKind::Unary { .. } => self.plain(id, raw, place, true),
            _ => self.plain_leaf(raw, place),
        }
    }

    /// A name or a literal.
    #[inline]
    fn plain_leaf(&mut self, raw: &hir::Expr, place: Place) -> Option<Written> {
        let span = Span::new(raw.pos, raw.end);
        Some(match raw.kind {
            hir::ExprKind::Ident(_) => {
                if place != Place::Free && is_special_name(self.text_of(span)) {
                    return None;
                }
                self.source(span)
            }
            hir::ExprKind::This => self.token("this"),
            hir::ExprKind::Null => self.token("null"),
            hir::ExprKind::True => self.token("true"),
            hir::ExprKind::False => self.token("false"),
            // Not a template, which has the same kind of record.
            hir::ExprKind::String(_)
                if matches!(self.source.get(raw.pos as usize), Some(b'"' | b'\'')) =>
            {
                self.string(span)
            }
            hir::ExprKind::Number(_)
                if place != Place::Object && self.text_of(span).iter().all(u8::is_ascii_digit) =>
            {
                self.source(span)
            }
            _ => return None,
        })
    }

    /// True if `id` is a chain of member accesses and at most two calls that starts with a name or `this`, without `?.`,
    /// `!` or type arguments. A chain with more calls can break whether it fits or not. A call that's too wide has rules
    /// of its own.
    fn is_plain_chain(&self, mut id: ExprId) -> bool {
        let file = self.f.file();
        let (mut calls, mut links) = (0, 0);
        let mut is_callee = false;
        loop {
            let Some(raw) = file.plain_expr(id) else {
                return false;
            };
            links += 1;
            let was_callee = std::mem::replace(&mut is_callee, false);
            id = match raw.kind {
                hir::ExprKind::Dot {
                    obj,
                    chain: Chain::No,
                    name_before_end,
                    ..
                } if name_before_end < hir::FAR_IN_BRACKETS => obj,
                hir::ExprKind::Index {
                    obj,
                    chain: Chain::No,
                    ..
                } => obj,
                hir::ExprKind::Call(call) => {
                    let Some(call) = file.plain_call(call) else {
                        return false;
                    };
                    calls += 1;
                    if call.chain != Chain::No
                        || !call.type_args.is_empty()
                        || calls > 2
                        || self.breaks
                    {
                        return false;
                    }
                    is_callee = true;
                    call.callee
                }
                hir::ExprKind::Ident(_) => {
                    let name = self.text_of(Span::new(raw.pos, raw.end));
                    // `graphql(schema, `..`)` has another language in it.
                    return !is_special_name(name) && !(was_callee && name == b"graphql");
                }
                hir::ExprKind::This => return true,
                _ => return false,
            };
            if links > MAX_LINKS {
                return false;
            }
        }
    }

    /// Writes what [`Line::is_plain_chain`] is true for.
    fn plain_chain(&mut self, id: ExprId) -> Written {
        let file = self.f.file();
        let raw = file.plain_expr(id).ok_or(Refused)?;
        match raw.kind {
            hir::ExprKind::Dot {
                obj,
                name_before_end,
                ..
            } => {
                self.plain_chain(obj)?;
                self.byte(b'.')?;
                self.source(Span::new(raw.end - u32::from(name_before_end), raw.end))
            }
            hir::ExprKind::Index { obj, index, .. } => {
                self.plain_chain(obj)?;
                self.byte(b'[')?;
                self.nested(|line| line.expr(file.handle_of_plain_expr(index), Place::Free))?;
                self.byte(b']')
            }
            hir::ExprKind::Call(call) => {
                let call = file.plain_call(call).ok_or(Refused)?;
                self.plain_chain(call.callee)?;
                self.plain_arguments(file.plain_list(call.args))
            }
            hir::ExprKind::This => self.token("this"),
            _ => self.source(Span::new(raw.pos, raw.end)),
        }
    }

    /// `(a, b)`
    fn plain_arguments(&mut self, args: &'a [u32]) -> Written {
        let file = self.f.file();
        self.byte(b'(')?;
        if args.len() > 1 {
            // Several functions among the arguments, or in the arguments of an argument, are each on a line.
            let mut functions = 0;
            for &argument in args {
                let mut kind = file.plain_expr(ExprId(argument)).ok_or(Refused)?.kind;
                while let hir::ExprKind::NonNull(inner) = kind {
                    kind = file.plain_expr(inner).ok_or(Refused)?.kind;
                }
                match kind {
                    hir::ExprKind::Fn(_) => functions += 1,
                    hir::ExprKind::Call(call) => {
                        let inner = file.plain_list(file.plain_call(call).ok_or(Refused)?.args);
                        if inner.iter().any(|&it| {
                            matches!(
                                file.plain_expr(ExprId(it)).map(|it| it.kind),
                                None | Some(hir::ExprKind::Fn(_))
                            )
                        }) {
                            return Err(Refused);
                        }
                    }
                    _ => {}
                }
            }
            if functions > 1 {
                return Err(Refused);
            }
        }
        for (index, &argument) in args.iter().enumerate() {
            if index > 0 {
                self.token(", ")?;
            }
            let id = ExprId(argument);
            let raw = file.plain_expr(id).ok_or(Refused)?;
            match self.plain_leaf(raw, Place::Free) {
                Some(written) => written?,
                None => {
                    self.nested(|line| line.expr(file.handle_of_plain_expr(id), Place::Free))?
                }
            }
        }
        self.byte(b')')
    }
}
